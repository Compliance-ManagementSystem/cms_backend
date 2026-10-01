/**
 * Authentication & Authorization Routes
 */

import { Router } from 'express';
import {
  login,
  logout,
  getMe,
  refreshTokenHandler,
} from '../controllers/auth.controller.js';
import {
  authenticate,
  authorize,
  requirePermission,
} from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginSchema } from '../validations/auth.validation.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ROLES, PERMISSIONS } from '../constants/permissions.js';

const router = Router();

// ── Public Auth Endpoints ───────────────────────────────────────────────────
router.post('/login', validate(loginSchema), login);
router.post('/logout', logout);
router.post('/refresh', refreshTokenHandler);

// ── Authenticated User Profile ──────────────────────────────────────────────
router.get('/me', authenticate, getMe);

// ── RBAC Verification Test Endpoints (Used for automated testing) ───────────
router.get(
  '/test/super-admin-only',
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  (req, res) => {
    res.json(
      ApiResponse.ok('Super Admin access granted', {
        user: req.user?.email,
        role: (req.user?.role as any)?.code,
      })
    );
  }
);

router.get(
  '/test/admin-or-above',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ENTITY_ADMIN),
  (req, res) => {
    res.json(
      ApiResponse.ok('Admin-tier access granted', {
        user: req.user?.email,
        role: (req.user?.role as any)?.code,
      })
    );
  }
);

router.get(
  '/test/require-entity-create',
  authenticate,
  requirePermission(PERMISSIONS.ENTITY_CREATE),
  (req, res) => {
    res.json(
      ApiResponse.ok('Permission entity:create verified', {
        user: req.user?.email,
        role: (req.user?.role as any)?.code,
      })
    );
  }
);

router.get(
  '/test/require-compliance-submit',
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_RECORD_SUBMIT),
  (req, res) => {
    res.json(
      ApiResponse.ok('Permission compliance_record:submit verified', {
        user: req.user?.email,
        role: (req.user?.role as any)?.code,
      })
    );
  }
);

export default router;
