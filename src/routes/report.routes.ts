/**
 * Report Routes
 *
 * Mounted at /api/reports
 * Protected by JWT authentication and RBAC authorization
 */

import { Router } from 'express';
import { ReportController } from '../controllers/report.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';

const router = Router();

// Require authentication for all reporting operations
router.use(authenticate);

// Filter options lookup
router.get(
  '/filters',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getFilters
);

// CSV and Excel exports
router.get(
  '/export/csv',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.exportCsv
);

router.get(
  '/export/excel',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.exportExcel
);

// Dedicated report views
router.get(
  '/compliance',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getComplianceReport
);

router.get(
  '/expiry',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getExpiryReport
);

router.get(
  '/pending',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getPendingReport
);

router.get(
  '/overdue',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getOverdueReport
);

router.get(
  '/entities',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getEntityReport
);

router.get(
  '/locations',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getLocationReport
);

router.get(
  '/tasks',
  authorize(['super_admin', 'admin', 'entity_admin', 'location_manager', 'compliance_officer', 'viewer']),
  ReportController.getTaskReport
);

export default router;
