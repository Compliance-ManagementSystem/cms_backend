/**
 * Admin Role Controller
 *
 * Role CRUD, permissions matrix configuration, system role protection, and audit logging.
 */

import { Request, Response } from 'express';
import Role from '../models/Role.js';
import User from '../models/User.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// ── 1. List All Roles with User Counts ───────────────────────────────────────
export const getRoles = asyncHandler(async (_req: Request, res: Response) => {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 }).lean();

  // Aggregate user count for each role
  const userCounts = await User.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);

  const countMap: Record<string, number> = {};
  userCounts.forEach((c) => {
    if (c._id) countMap[c._id.toString()] = c.count;
  });

  const rolesWithMeta = roles.map((role) => ({
    ...role,
    userCount: countMap[role._id.toString()] || 0,
    permissionCount: (role.permissions || []).reduce((acc: number, p: any) => acc + (p.actions?.length || 0), 0),
  }));

  return ApiResponse.success(res, { roles: rolesWithMeta });
});

// ── 2. Get Single Role Details ───────────────────────────────────────────────
export const getRoleById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const role = await Role.findById(id);

  if (!role) {
    throw ApiError.notFound(`Role not found with ID '${id}'`);
  }

  const userCount = await User.countDocuments({ role: id });

  return ApiResponse.success(res, { role, userCount });
});

// ── 3. Create Custom Role ────────────────────────────────────────────────────
export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const { name, code, description, permissions } = req.body;

  const existingRole = await Role.findOne({ code });
  if (existingRole) {
    throw ApiError.conflict(`A role with code '${code}' already exists.`);
  }

  const role = await Role.create({
    name,
    code,
    description: description || '',
    permissions: permissions || [],
    isSystem: false,
    status: 'active',
  });

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'Role',
    resourceId: role._id,
    newValue: { name, code, permissionsCount: permissions?.length || 0 },
    description: `Created custom role '${name}' (${code})`,
  });

  return ApiResponse.created(res, { role }, 'Role created successfully');
});

// ── 4. Update Role ───────────────────────────────────────────────────────────
export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, permissions, status } = req.body;

  const role = await Role.findById(id);
  if (!role) {
    throw ApiError.notFound(`Role not found with ID '${id}'`);
  }

  const previousState = {
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    status: role.status,
  };

  if (name) role.name = name;
  if (description !== undefined) role.description = description;
  if (permissions) role.permissions = permissions;
  if (status && !role.isSystem) role.status = status; // Cannot deactivate core system roles

  await role.save();

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'Role',
    resourceId: role._id,
    previousValue: previousState,
    newValue: { name: role.name, permissionsCount: role.permissions.length },
    description: `Updated role definition for '${role.name}' (${role.code})`,
  });

  return ApiResponse.success(res, { role }, 'Role updated successfully');
});

// ── 5. Delete Role ───────────────────────────────────────────────────────────
export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const role = await Role.findById(id);
  if (!role) {
    throw ApiError.notFound(`Role not found with ID '${id}'`);
  }

  if (role.isSystem) {
    throw ApiError.badRequest(`System role '${role.name}' is protected and cannot be deleted.`);
  }

  const usersWithRole = await User.countDocuments({ role: id });
  if (usersWithRole > 0) {
    throw ApiError.badRequest(
      `Cannot delete role '${role.name}'. It is currently assigned to ${usersWithRole} user(s). Reassign them first.`
    );
  }

  await Role.findByIdAndDelete(id);

  await logAuditEvent({
    req,
    action: 'delete',
    resource: 'Role',
    resourceId: role._id,
    previousValue: { name: role.name, code: role.code },
    description: `Deleted custom role '${role.name}' (${role.code})`,
  });

  return ApiResponse.success(res, null, `Role '${role.name}' deleted successfully`);
});
