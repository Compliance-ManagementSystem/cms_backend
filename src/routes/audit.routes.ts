/**
 * Audit Log Routes
 *
 * Mounted at /api/audit-logs
 * Strictly read-only to preserve immutable audit integrity.
 */

import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';

const router = Router();

// Authentication and Authorization required
router.use(authenticate);
router.use(authorize(['super_admin', 'admin', 'entity_admin', 'compliance_officer']));

// Query routes
router.get('/', AuditController.getAuditLogs);
router.get('/filters', AuditController.getFilters);
router.get('/:id', AuditController.getAuditLogById);

export default router;
