/**
 * Admin User Controller
 *
 * Full User CRUD, filtering, pagination, status toggling, and audit logging.
 */

import { Request, Response } from 'express';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Entity from '../models/Entity.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// ── 1. Get Paginated Users with Search & Filter ──────────────────────────────
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
  const search = (req.query.search as string)?.trim();
  const role = req.query.role as string;
  const status = req.query.status as string;
  const entityId = req.query.entityId as string;

  const query: Record<string, any> = {};

  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { department: searchRegex },
      { designation: searchRegex },
    ];
  }

  if (role) {
    query.role = role;
  }

  if (status) {
    query.status = status;
  }

  if (entityId) {
    query.entity = entityId === 'null' ? null : entityId;
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query)
      .populate('role', 'name code isSystem')
      .populate('entity', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return ApiResponse.success(res, {
    users,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. Get Single User Details ───────────────────────────────────────────────
export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await User.findById(id)
    .populate('role')
    .populate('entity', 'name code')
    .populate('assignedLocations', 'name code');

  if (!user) {
    throw ApiError.notFound(`User not found with ID '${id}'`);
  }

  return ApiResponse.success(res, { user });
});

// ── 3. Create User ───────────────────────────────────────────────────────────
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { firstName, lastName, email, password, role, entity, phone, status } = req.body;

  // Check email uniqueness
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict(`A user with email '${email}' already exists.`);
  }

  // Validate role exists
  const roleDoc = await Role.findById(role);
  if (!roleDoc) {
    throw ApiError.badRequest('Invalid role ID specified.');
  }

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role,
    entity: entity || null,
    phone,
    status: status || 'active',
    createdBy: req.user?._id,
  });

  const populatedUser = await User.findById(user._id)
    .populate('role', 'name code isSystem')
    .populate('entity', 'name code');

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'User',
    resourceId: user._id,
    entity: entity || null,
    newValue: { email, firstName, lastName, role: roleDoc.name, status },
    description: `Created new user ${email} with role ${roleDoc.name}`,
  });

  return ApiResponse.created(res, { user: populatedUser }, 'User created successfully');
});

// ── 4. Update User ───────────────────────────────────────────────────────────
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { firstName, lastName, email, role, entity, phone, status, password } = req.body;

  const user = await User.findById(id).select('+password');
  if (!user) {
    throw ApiError.notFound(`User not found with ID '${id}'`);
  }

  const previousState = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  // Check email uniqueness if being updated
  if (email && email !== user.email) {
    const existing = await User.findOne({ email });
    if (existing) {
      throw ApiError.conflict(`Email '${email}' is already in use by another user.`);
    }
    user.email = email;
  }

  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (phone !== undefined) user.phone = phone;
  if (role) {
    const roleDoc = await Role.findById(role);
    if (!roleDoc) {
      throw ApiError.badRequest('Invalid role ID specified.');
    }
    user.role = role;
  }
  if (entity !== undefined) {
    user.entity = entity || null;
  }
  if (status) {
    user.status = status;
  }

  // Update password if provided
  if (password && password.trim().length >= 8) {
    user.password = password;
  }

  user.updatedBy = req.user?._id;
  await user.save();

  const updatedUser = await User.findById(id)
    .populate('role', 'name code isSystem')
    .populate('entity', 'name code');

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'User',
    resourceId: user._id,
    entity: user.entity,
    previousValue: previousState,
    newValue: { firstName: user.firstName, lastName: user.lastName, email: user.email, status: user.status },
    description: `Updated user profile for ${user.email}`,
  });

  return ApiResponse.success(res, { user: updatedUser }, 'User updated successfully');
});

// ── 5. Toggle User Status (Deactivate / Reactivate) ─────────────────────────
export const toggleUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (req.user && req.user._id.toString() === id && status !== 'active') {
    throw ApiError.badRequest('You cannot deactivate your own administrative account.');
  }

  const user = await User.findById(id);
  if (!user) {
    throw ApiError.notFound(`User not found with ID '${id}'`);
  }

  const prevStatus = user.status;
  user.status = status;
  user.updatedBy = req.user?._id;
  await user.save();

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'User',
    resourceId: user._id,
    previousValue: { status: prevStatus },
    newValue: { status },
    description: `Changed user status of ${user.email} from ${prevStatus} to ${status}`,
  });

  return ApiResponse.success(res, { user }, `User status updated to ${status}`);
});

// ── 6. Delete User ───────────────────────────────────────────────────────────
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (req.user && req.user._id.toString() === id) {
    throw ApiError.badRequest('You cannot delete your own account.');
  }

  const user = await User.findById(id).populate('role', 'code isSystem');
  if (!user) {
    throw ApiError.notFound(`User not found with ID '${id}'`);
  }

  if ((user.role as any)?.code === 'super_admin') {
    const superAdminCount = await User.countDocuments({
      role: (user.role as any)._id,
      status: 'active',
    });
    if (superAdminCount <= 1) {
      throw ApiError.badRequest('Cannot delete the sole active Super Admin account.');
    }
  }

  await User.findByIdAndDelete(id);

  await logAuditEvent({
    req,
    action: 'delete',
    resource: 'User',
    resourceId: user._id,
    previousValue: { email: user.email, name: user.fullName },
    description: `Deleted user account ${user.email}`,
  });

  return ApiResponse.success(res, null, `User '${user.email}' deleted successfully`);
});
