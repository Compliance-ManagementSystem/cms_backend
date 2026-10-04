/**
 * Compliance Record Routes
 *
 * Mounts endpoints for compliance records:
 * GET /api/compliance/records
 * GET /api/compliance/records/:id
 * POST /api/compliance/records
 * PUT /api/compliance/records/:id
 * PATCH /api/compliance/records/:id/status
 * POST /api/compliance/records/generate-for-location
 * DELETE /api/compliance/records/:id
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getComplianceRecords,
  getComplianceRecordById,
  createComplianceRecord,
  updateComplianceRecord,
  updateComplianceRecordStatus,
  generateRecordsForLocation,
  deleteComplianceRecord,
  executeWorkflowAction,
  getComplianceRecordApprovals,
} from '../controllers/complianceRecord.controller.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.COMPLIANCE_RECORD_READ), getComplianceRecords);
router.post('/', requirePermission(PERMISSIONS.COMPLIANCE_RECORD_CREATE), createComplianceRecord);
router.post(
  '/generate-for-location',
  requirePermission(PERMISSIONS.COMPLIANCE_RECORD_CREATE),
  generateRecordsForLocation
);
router.get('/:id', requirePermission(PERMISSIONS.COMPLIANCE_RECORD_READ), getComplianceRecordById);
router.put('/:id', requirePermission(PERMISSIONS.COMPLIANCE_RECORD_UPDATE), updateComplianceRecord);
// Direct status update, as on the Location Master sheet: anyone who may edit records
// sets the status (and licence details) in one step, within their entity / location scope.
// POST /:id/workflow remains for the step-by-step approval route.
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.COMPLIANCE_RECORD_UPDATE),
  updateComplianceRecordStatus
);
// Role and transition rules are enforced by ApprovalWorkflowService
router.post('/:id/workflow', executeWorkflowAction);
router.get(
  '/:id/approvals',
  requirePermission(PERMISSIONS.COMPLIANCE_RECORD_READ),
  getComplianceRecordApprovals
);
router.delete('/:id', requirePermission(PERMISSIONS.COMPLIANCE_RECORD_DELETE), deleteComplianceRecord);

export default router;
