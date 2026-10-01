/**
 * Admin Permission Controller
 *
 * Granular permissions catalog inspection, custom permission creation, and audit logging.
 */

import { Request, Response } from 'express';
import Permission from '../models/Permission.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// ── 1. List Permissions Catalog with Filtering ──────────────────────────────
export const getPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { module, search } = req.query;

  const query: Record<string, any> = {};

  if (module) {
    query.module = (module as string).toLowerCase();
  }

  if (search) {
    const searchRegex = new RegExp(search as string, 'i');
    query.$or = [{ name: searchRegex }, { code: searchRegex }, { description: searchRegex }];
  }

  const [permissions, modules] = await Promise.all([
    Permission.find(query).sort({ module: 1, action: 1 }).lean(),
    Permission.distinct('module'),
  ]);

  return ApiResponse.success(res, {
    permissions,
    modules: modules.sort(),
    total: permissions.length,
  });
});

// ── 2. Create Permission ─────────────────────────────────────────────────────
export const createPermission = asyncHandler(async (req: Request, res: Response) => {
  const { name, code, module, action, description } = req.body;

  const existing = await Permission.findOne({ code });
  if (existing) {
    throw ApiError.conflict(`Permission with code '${code}' already exists.`);
  }

  const permission = await Permission.create({
    name,
    code,
    module,
    action,
    description: description || '',
    isSystem: false,
    status: 'active',
  });

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'Permission',
    resourceId: permission._id,
    newValue: { name, code, module, action },
    description: `Created permission '${code}' (${name})`,
  });

  return ApiResponse.created(res, { permission }, 'Permission created successfully');
});

// ── 3. Update Permission ─────────────────────────────────────────────────────
export const updatePermission = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, status } = req.body;

  const permission = await Permission.findById(id);
  if (!permission) {
    throw ApiError.notFound(`Permission not found with ID '${id}'`);
  }

  const previousState = {
    name: permission.name,
    description: permission.description,
    status: permission.status,
  };

  if (name) permission.name = name;
  if (description !== undefined) permission.description = description;
  if (status) permission.status = status;

  await permission.save();

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'Permission',
    resourceId: permission._id,
    previousValue: previousState,
    newValue: { name: permission.name, status: permission.status },
    description: `Updated permission '${permission.code}'`,
  });

  return ApiResponse.success(res, { permission }, 'Permission updated successfully');
});

// ── 4. Delete Permission ─────────────────────────────────────────────────────
export const deletePermission = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const permission = await Permission.findById(id);
  if (!permission) {
    throw ApiError.notFound(`Permission not found with ID '${id}'`);
  }

  if (permission.isSystem) {
    throw ApiError.badRequest(`System permission '${permission.code}' is protected and cannot be deleted.`);
  }

  await Permission.findByIdAndDelete(id);

  await logAuditEvent({
    req,
    action: 'delete',
    resource: 'Permission',
    resourceId: permission._id,
    previousValue: { name: permission.name, code: permission.code },
    description: `Deleted permission '${permission.code}'`,
  });

  return ApiResponse.success(res, null, `Permission '${permission.code}' deleted successfully`);
});
