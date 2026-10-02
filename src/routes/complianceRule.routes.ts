/**
 * Compliance Rule Routes
 *
 * REST endpoints for Compliance Rule Engine configuration and evaluation.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  getComplianceRules,
  getComplianceRuleById,
  createComplianceRule,
  updateComplianceRule,
  toggleRuleStatus,
  archiveComplianceRule,
  deleteComplianceRule,
  evaluateRuleApplicability,
} from '../controllers/complianceRule.controller.js';
import {
  createComplianceRuleSchema,
  updateComplianceRuleSchema,
  complianceRuleQuerySchema,
  evaluateRuleSchema,
} from '../validations/complianceRule.validation.js';

const router = Router();

router.use(authenticate);

// List & Evaluation
router.get(
  '/',
  requirePermission('compliance_rule:read'),
  validate(complianceRuleQuerySchema, 'query'),
  getComplianceRules
);

// NOTE: /evaluate must be before /:id so Express doesn't treat 'evaluate' as an ID
router.post(
  '/evaluate',
  requirePermission('compliance_rule:read'),
  validate(evaluateRuleSchema),
  evaluateRuleApplicability
);

router.get(
  '/:id',
  requirePermission('compliance_rule:read'),
  getComplianceRuleById
);

router.post(
  '/',
  requirePermission('compliance_rule:create'),
  validate(createComplianceRuleSchema),
  createComplianceRule
);

router.put(
  '/:id',
  requirePermission('compliance_rule:update'),
  validate(updateComplianceRuleSchema),
  updateComplianceRule
);

// Toggle active ↔ inactive
router.patch(
  '/:id/status',
  requirePermission('compliance_rule:update'),
  toggleRuleStatus
);

// Archive (moves to archived state — distinct from inactive) — Feature F fix
router.patch(
  '/:id/archive',
  requirePermission('compliance_rule:update'),
  archiveComplianceRule
);

router.delete(
  '/:id',
  requirePermission('compliance_rule:delete'),
  deleteComplianceRule
);

export default router;
