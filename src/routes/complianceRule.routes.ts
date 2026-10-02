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
  restoreComplianceRule,
  deleteComplianceRule,
  evaluateRuleApplicability,
  getRuleCoverage,
  previewRuleCoverage,
  generateRuleRecords,
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

// Coverage of unsaved criteria, used by the rule form
router.post(
  '/preview-coverage',
  requirePermission('compliance_rule:read'),
  previewRuleCoverage
);

router.get(
  '/:id',
  requirePermission('compliance_rule:read'),
  getComplianceRuleById
);

// Locations the rule applies to, and whether each already has a record
router.get(
  '/:id/coverage',
  requirePermission('compliance_rule:read'),
  getRuleCoverage
);

router.post(
  '/:id/generate-records',
  requirePermission('compliance_record:create'),
  generateRuleRecords
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

router.patch(
  '/:id/restore',
  requirePermission('compliance_rule:update'),
  restoreComplianceRule
);

router.delete(
  '/:id',
  requirePermission('compliance_rule:delete'),
  deleteComplianceRule
);

export default router;
