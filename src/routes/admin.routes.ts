/**
 * Admin Module Routes
 *
 * Administrative endpoints for User, Role, Permission, Master Data, and System Settings.
 * Restricted to authenticated Super Admins and Admins.
 */

import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { ROLES } from '../constants/permissions.js';

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
} from '../controllers/adminUser.controller.js';

import {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from '../controllers/adminRole.controller.js';

import {
  getPermissions,
  createPermission,
  updatePermission,
  deletePermission,
} from '../controllers/adminPermission.controller.js';

import {
  getCategories,
  getMasterData,
  getMasterDataById,
  createMasterData,
  updateMasterData,
  toggleMasterDataStatus,
  deleteMasterData,
} from '../controllers/adminMasterData.controller.js';

import {
  getSettings,
  updateSettings,
} from '../controllers/adminSettings.controller.js';

import {
  createUserSchema,
  updateUserSchema,
  userStatusSchema,
  createRoleSchema,
  updateRoleSchema,
  createPermissionSchema,
  createMasterDataSchema,
  updateMasterDataSchema,
  updateSettingsSchema,
} from '../validations/admin.validation.js';

const router = Router();

// Apply Authentication and RBAC (Super Admin & Admin only) to all admin routes
router.use(authenticate);
router.use(authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN));

// ── User Management ─────────────────────────────────────────────────────────
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.post('/users', validate(createUserSchema), createUser);
router.put('/users/:id', validate(updateUserSchema), updateUser);
router.patch('/users/:id/status', validate(userStatusSchema), toggleUserStatus);
router.delete('/users/:id', deleteUser);

// ── Role Management ─────────────────────────────────────────────────────────
router.get('/roles', getRoles);
router.get('/roles/:id', getRoleById);
router.post('/roles', validate(createRoleSchema), createRole);
router.put('/roles/:id', validate(updateRoleSchema), updateRole);
router.delete('/roles/:id', deleteRole);

// ── Permission Management ───────────────────────────────────────────────────
router.get('/permissions', getPermissions);
router.post('/permissions', validate(createPermissionSchema), createPermission);
router.put('/permissions/:id', updatePermission);
router.delete('/permissions/:id', deletePermission);

// ── Master Data Management ──────────────────────────────────────────────────
router.get('/master-data/categories', getCategories);
router.get('/master-data', getMasterData);
router.get('/master-data/:id', getMasterDataById);
router.post('/master-data', validate(createMasterDataSchema), createMasterData);
router.put('/master-data/:id', validate(updateMasterDataSchema), updateMasterData);
router.patch('/master-data/:id/status', toggleMasterDataStatus);
router.delete('/master-data/:id', deleteMasterData);

// ── System Settings ─────────────────────────────────────────────────────────
router.get('/settings', getSettings);
router.put('/settings', validate(updateSettingsSchema), updateSettings);

export default router;
