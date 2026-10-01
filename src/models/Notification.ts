/**
 * Notification Model
 *
 * In-app, email, WhatsApp, and SMS notification records.
 * Maps to Phase 5: Tasks & Notifications → Send email / WhatsApp alerts.
 *
 * One notification document per recipient per event.
 * Delivery status tracked per channel.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { NotificationType, NotificationChannel, Ref } from '../types/models.js';

// ── Delivery status (embedded per channel) ────────────────────────────────────

export interface IDeliveryStatus {
  channel: NotificationChannel;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped';
  sentAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  externalId?: string;      // Provider's message ID (SendGrid, Twilio, etc.)
}

const deliveryStatusSchema = new Schema<IDeliveryStatus>(
  {
    channel:       { type: String, enum: ['in_app', 'email', 'whatsapp', 'sms'], required: true },
    status:        { type: String, enum: ['pending', 'sent', 'delivered', 'failed', 'skipped'], default: 'pending' },
    sentAt:        { type: Date },
    deliveredAt:   { type: Date },
    failureReason: { type: String },
    externalId:    { type: String },
  },
  { _id: false }
);

// ── Notification document ──────────────────────────────────────────────────────

export interface INotification extends Document {
  _id: Types.ObjectId;
  recipient: Ref<unknown>;          // → User
  type: NotificationType;

  title: string;
  body: string;
  actionUrl?: string;               // Deep link into the app

  // Context references (polymorphic — one or more may be set)
  relatedTask?: Ref<unknown>;             // → Task
  relatedComplianceRecord?: Ref<unknown>; // → ComplianceRecord
  relatedLicence?: Ref<unknown>;          // → Licence
  entity?: Ref<unknown>;                  // → Entity

  channels: IDeliveryStatus[];
  isRead: boolean;
  readAt?: Date;

  scheduledFor?: Date;              // For future-scheduled notifications
  expiresAt?: Date;                 // After this, stale notification is hidden

  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'task_assigned', 'task_due', 'task_overdue',
        'compliance_expiring', 'compliance_expired',
        'document_uploaded',
        'approval_required', 'approval_approved', 'approval_rejected',
        'licence_expiring', 'licence_expired',
        'system',
      ],
    },

    title:     { type: String, required: true },
    body:      { type: String, required: true },
    actionUrl: { type: String },

    relatedTask:             { type: Schema.Types.ObjectId, ref: 'Task' },
    relatedComplianceRecord: { type: Schema.Types.ObjectId, ref: 'ComplianceRecord' },
    relatedLicence:          { type: Schema.Types.ObjectId, ref: 'Licence' },
    entity:                  { type: Schema.Types.ObjectId, ref: 'Entity' },

    channels: { type: [deliveryStatusSchema], default: [] },
    isRead:   { type: Boolean, default: false },
    readAt:   { type: Date },

    scheduledFor: { type: Date },
    expiresAt:    { type: Date },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ scheduledFor: 1 });    // Scheduler job
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

const Notification: Model<INotification> = mongoose.model<INotification>(
  'Notification',
  notificationSchema
);
export default Notification;
