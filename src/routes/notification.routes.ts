import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', notificationController.getMyNotifications.bind(notificationController));
router.get('/unread-count', notificationController.getUnreadCount.bind(notificationController));
router.patch('/read-all', notificationController.markAllAsRead.bind(notificationController));
router.patch('/:id/read', notificationController.markAsRead.bind(notificationController));
router.delete('/:id', notificationController.deleteNotification.bind(notificationController));

export default router;
