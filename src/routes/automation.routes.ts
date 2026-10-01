import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../constants/permissions.js';
import { schedulerService } from '../services/scheduler.service.js';

const router = Router();

// Only Super Admin and Admin can trigger manual automation checks
router.post(
  '/run-checks',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await schedulerService.runComplianceChecks();
      res.status(200).json({
        success: true,
        message: 'Compliance automation checks executed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
