import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/stats', dashboardController.getDashboardStats.bind(dashboardController));
router.get('/filters', dashboardController.getFilterOptions.bind(dashboardController));

export default router;
