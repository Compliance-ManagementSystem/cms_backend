import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification.service.js';
import { ApiError } from '../utils/apiError.js';

export class NotificationController {
  /**
   * GET /api/notifications
   * List notifications for logged in user
   */
  public async getMyNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      const { page, limit, unreadOnly } = req.query;

      const result = await notificationService.getUserNotifications(
        userId.toString(),
        page ? parseInt(page as string, 10) : 1,
        limit ? parseInt(limit as string, 10) : 20,
        unreadOnly === 'true'
      );

      res.status(200).json({
        success: true,
        data: result.notifications,
        unreadCount: result.unreadCount,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/notifications/unread-count
   * Fast counter for navbar bell
   */
  public async getUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      const count = await notificationService.getUnreadCount(userId.toString());
      res.status(200).json({
        success: true,
        data: { count },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/notifications/:id/read
   */
  public async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      const notification = await notificationService.markAsRead(req.params.id, userId.toString());
      if (!notification) {
        throw ApiError.notFound('Notification not found');
      }

      res.status(200).json({
        success: true,
        message: 'Notification marked as read',
        data: notification,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/notifications/read-all
   */
  public async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      const updatedCount = await notificationService.markAllAsRead(userId.toString());
      res.status(200).json({
        success: true,
        message: `Marked ${updatedCount} notifications as read`,
        data: { updatedCount },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/notifications/:id
   */
  public async deleteNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      await notificationService.deleteNotification(req.params.id, userId.toString());
      res.status(200).json({
        success: true,
        message: 'Notification deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const notificationController = new NotificationController();
