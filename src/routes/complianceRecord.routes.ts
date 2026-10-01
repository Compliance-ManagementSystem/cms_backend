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
import { authenticate } from '../middlewares/auth.middleware.js';
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

router.get('/', getComplianceRecords);
router.post('/', createComplianceRecord);
router.post('/generate-for-location', generateRecordsForLocation);
router.get('/:id', getComplianceRecordById);
router.put('/:id', updateComplianceRecord);
router.patch('/:id/status', updateComplianceRecordStatus);
router.post('/:id/workflow', executeWorkflowAction);
router.get('/:id/approvals', getComplianceRecordApprovals);
router.delete('/:id', deleteComplianceRecord);

export default router;
