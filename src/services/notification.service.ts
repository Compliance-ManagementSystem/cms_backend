/**
 * Notification Service
 *
 * Coordinates multi-channel notifications:
 * - Persistent MongoDB records
 * - In-app real-time alerts via Socket.IO
 * - Email notification architecture
 */

import { Types } from 'mongoose';
import Notification, { INotification } from '../models/Notification.js';
import User from '../models/User.js';
import { emitNotification } from './socket.service.js';
import { EmailService } from './email.service.js';
import { ApiError } from '../utils/apiError.js';
import type { NotificationType, NotificationChannel } from '../types/models.js';

export interface CreateNotificationInput {
  recipientId: string | Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string;
  relatedTask?: string | Types.ObjectId;
  relatedComplianceRecord?: string | Types.ObjectId;
  entity?: string | Types.ObjectId;
  channels?: NotificationChannel[];
  emailData?: Record<string, any>;
}

export class NotificationService {
  /**
   * Dispatches a notification across in-app and email channels.
   */
  public static async dispatchNotification(
    input: CreateNotificationInput
  ): Promise<INotification> {
    const {
      recipientId,
      type,
      title,
      body,
      actionUrl,
      relatedTask,
      relatedComplianceRecord,
      entity,
      channels = ['in_app', 'email'],
      emailData,
    } = input;

    const recipientUser = await User.findById(recipientId).select('email firstName lastName');

    // 1. Build channel delivery tracking
    const deliveryChannels = channels.map((ch) => ({
      channel: ch,
      status: 'pending' as const,
      sentAt: ch === 'in_app' ? new Date() : undefined,
    }));

    // 2. Persist in MongoDB
    const notification = await Notification.create({
      recipient: recipientId,
      type,
      title,
      body,
      actionUrl,
      relatedTask,
      relatedComplianceRecord,
      entity,
      channels: deliveryChannels,
      isRead: false,
    });

    // 3. Emit real-time in-app notification via Socket.IO
    if (channels.includes('in_app')) {
      emitNotification(recipientId.toString(), {
        _id: notification._id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt,
        isRead: false,
      });
    }

    // 4. Send email notification via EmailService architecture
    if (channels.includes('email') && recipientUser?.email) {
      try {
        let emailTemplate: any = 'system';
        if (type === 'task_assigned') emailTemplate = 'task_assigned';
        else if (type === 'compliance_expiring') emailTemplate = 'compliance_expiring';
        else if (type === 'compliance_expired') emailTemplate = 'compliance_expired';
        else if (type === 'task_overdue') emailTemplate = 'task_overdue';
        else if (type === 'approval_required') emailTemplate = 'approval_pending';
        else if (type === 'approval_approved') emailTemplate = 'compliance_approved';
        else if (type === 'approval_rejected') emailTemplate = 'compliance_rejected';

        await EmailService.sendEmail({
          to: recipientUser.email,
          recipientName: recipientUser.firstName,
          subject: title,
          template: emailTemplate,
          data: emailData || {
            title,
            body,
            date: new Date().toLocaleDateString(),
          },
        });

        // Mark email channel as sent
        await Notification.updateOne(
          { _id: notification._id, 'channels.channel': 'email' },
          { $set: { 'channels.$.status': 'sent', 'channels.$.sentAt': new Date() } }
        );
      } catch (err) {
        console.error(`Failed to send email notification to ${recipientUser.email}:`, err);
      }
    }

    return notification;
  }

  /**
   * Retrieves paginated notifications for a recipient
   */
  public static async getUserNotifications(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ): Promise<{ notifications: INotification[]; total: number; unreadCount: number }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { recipient: new Types.ObjectId(userId) };
    if (options.unreadOnly) {
      filter.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('relatedComplianceRecord', 'recordNumber status')
        .populate('relatedTask', 'title priority status'),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: new Types.ObjectId(userId), isRead: false }),
    ]);

    return { notifications, total, unreadCount };
  }

  /**
   * Marks a single notification as read
   */
  public static async markAsRead(notificationId: string, userId: string): Promise<INotification> {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) throw ApiError.notFound('Notification not found.');
    return notification;
  }

  /**
   * Marks all notifications as read for a user
   */
  public static async markAllAsRead(userId: string): Promise<number> {
    const result = await Notification.updateMany(
      { recipient: new Types.ObjectId(userId), isRead: false },
      { isRead: true, readAt: new Date() }
    );
    return result.modifiedCount;
  }

  /**
   * Deletes a notification
   */
  public static async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const res = await Notification.findOneAndDelete({ _id: notificationId, recipient: userId });
    if (!res) throw ApiError.notFound('Notification not found.');
  }

  /**
   * Quick unread count for navbar badges
   */
  public static async getUnreadCount(userId: string): Promise<number> {
    return Notification.countDocuments({ recipient: new Types.ObjectId(userId), isRead: false });
  }
}

export const notificationService = NotificationService;

