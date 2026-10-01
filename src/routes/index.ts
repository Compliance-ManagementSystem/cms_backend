import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import adminRoutes from './admin.routes.js';
import entityRoutes from './entity.routes.js';
import locationRoutes from './location.routes.js';
import complianceRuleRoutes from './complianceRule.routes.js';
import complianceRecordRoutes from './complianceRecord.routes.js';
import documentRoutes from './document.routes.js';
import taskRoutes from './task.routes.js';
import notificationRoutes from './notification.routes.js';
import automationRoutes from './automation.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import reportRoutes from './report.routes.js';
import auditRoutes from './audit.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/entities', entityRoutes);
router.use('/locations', locationRoutes);
router.use('/compliance/rules', complianceRuleRoutes);
router.use('/compliance/records', complianceRecordRoutes);
router.use('/documents', documentRoutes);
router.use('/tasks', taskRoutes);
router.use('/notifications', notificationRoutes);
router.use('/automation', automationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/audit', auditRoutes);

export default router;

