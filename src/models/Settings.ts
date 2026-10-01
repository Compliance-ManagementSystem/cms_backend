/**
 * Settings Model
 *
 * Application-wide and entity-level configuration.
 * Includes embedded workflow definition (replaces a separate Workflow model
 * since workflows are configuration, not transactional data).
 *
 * Scoped at two levels:
 *   - Global (entity: null) — super admin settings
 *   - Entity-level (entity: ObjectId) — entity-specific overrides
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { Ref } from '../types/models.js';

// ── Workflow step (embedded) ───────────────────────────────────────────────────

export interface IWorkflowStep {
  step: number;
  name: string;
  role: Ref<unknown>;         // → Role required for this step
  isRequired: boolean;
  canDelegate: boolean;
  slaHours?: number;          // Service Level Agreement in hours
}

const workflowStepSchema = new Schema<IWorkflowStep>(
  {
    step:        { type: Number, required: true },
    name:        { type: String, required: true },
    role:        { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    isRequired:  { type: Boolean, default: true },
    canDelegate: { type: Boolean, default: false },
    slaHours:    { type: Number, min: 1 },
  },
  { _id: false }
);

// ── Workflow (embedded in Settings) ───────────────────────────────────────────

export interface IWorkflow {
  name: string;
  code: string;         // e.g. "COMPLIANCE_APPROVAL", "LICENCE_RENEWAL"
  steps: IWorkflowStep[];
  isActive: boolean;
}

const workflowSchema = new Schema<IWorkflow>(
  {
    name:     { type: String, required: true },
    code:     { type: String, required: true, uppercase: true },
    steps:    { type: [workflowStepSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

// ── Notification settings (embedded) ──────────────────────────────────────────

export interface INotificationSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  defaultReminderDays: number[];
}

// ── Settings document ──────────────────────────────────────────────────────────

export interface ISettings extends Document {
  _id: Types.ObjectId;
  entity?: Ref<unknown>;  // → Entity. null = global settings

  // Notification preferences
  notifications: INotificationSettings;

  // Workflows (embedded — replaces separate Workflow collection)
  workflows: IWorkflow[];

  // Miscellaneous key-value config
  config: Record<string, unknown>;

  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    entity: {
      type: Schema.Types.ObjectId,
      ref: 'Entity',
      default: null,
      // unique index defined via schema.index() below to support sparse:true
    },

    notifications: {
      emailEnabled:        { type: Boolean, default: true },
      whatsappEnabled:     { type: Boolean, default: false },
      smsEnabled:          { type: Boolean, default: false },
      defaultReminderDays: { type: [Number], default: [90, 60, 30, 7] },
    },

    workflows: { type: [workflowSchema], default: [] },
    config:    { type: Schema.Types.Mixed, default: {} },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
settingsSchema.index({ entity: 1 }, { unique: true, sparse: true });

const Settings: Model<ISettings> = mongoose.model<ISettings>(
  'Settings',
  settingsSchema
);
export default Settings;
