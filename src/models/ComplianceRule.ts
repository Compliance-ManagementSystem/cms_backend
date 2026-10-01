/**
 * ComplianceRule Model
 *
 * Defines what compliance obligations must be tracked — the "Rule Engine" configuration.
 * Maps to Phase 7: Compliance Rule Engine.
 *
 * A ComplianceRule is evaluated against Entities & Locations to determine applicability.
 * Supports granular criteria: Entity Types, Location Types, States, and Frequency.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';

// ── Notification Rules (embedded) ─────────────────────────────────────────────

export interface INotificationRuleConfig {
  reminderDays: number[]; // e.g. [90, 60, 30, 15, 7]
  notifyRoles: string[];  // e.g. ['unit_manager', 'compliance_officer']
  channels: string[];     // e.g. ['email', 'in_app', 'sms', 'whatsapp']
}

const notificationRuleConfigSchema = new Schema<INotificationRuleConfig>(
  {
    reminderDays: {
      type: [Number],
      default: [90, 60, 30, 15, 7],
      validate: {
        validator: (v: number[]) => v.every((d) => d > 0),
        message: 'Reminder days must be positive integers.',
      },
    },
    notifyRoles: {
      type: [String],
      default: ['unit_manager', 'compliance_officer'],
    },
    channels: {
      type: [String],
      default: ['email', 'in_app'],
    },
  },
  { _id: false }
);

// ── Escalation Rules (embedded) ───────────────────────────────────────────────

export interface IEscalationRuleConfig {
  escalateAfterDays: number; // e.g. 7 days overdue
  escalateToRole: string;    // e.g. 'entity_admin' or 'super_admin'
  autoTaskCreation: boolean; // automatically spawn remedial task
  escalationMessage?: string;
}

const escalationRuleConfigSchema = new Schema<IEscalationRuleConfig>(
  {
    escalateAfterDays: { type: Number, default: 7, min: 0 },
    escalateToRole:    { type: String, default: 'entity_admin' },
    autoTaskCreation: { type: Boolean, default: true },
    escalationMessage: { type: String },
  },
  { _id: false }
);

// ── Required Document Definition ──────────────────────────────────────────────

export interface IRequiredDocumentConfig {
  documentType: Types.ObjectId; // → MasterData (category: document_type)
  label: string;
  isMandatory: boolean;
}

const requiredDocumentConfigSchema = new Schema<IRequiredDocumentConfig>(
  {
    documentType: { type: Schema.Types.ObjectId, ref: 'MasterData', required: true },
    label:        { type: String, required: true, trim: true },
    isMandatory:  { type: Boolean, default: true },
  },
  { _id: false }
);

// ── Applicability Criteria (embedded) ─────────────────────────────────────────

export interface IApplicability {
  entityTypes: Types.ObjectId[];    // → MasterData (entity_type). Empty = ALL entity types
  locationTypes: Types.ObjectId[];  // → MasterData (location_type). Empty = ALL location types
  states: string[];                 // State names or codes. Empty = ALL states
  industries?: Types.ObjectId[];    // → MasterData (industry). Empty = ALL industries
}

const applicabilitySchema = new Schema<IApplicability>(
  {
    entityTypes:   { type: [Schema.Types.ObjectId], ref: 'MasterData', default: [] },
    locationTypes: { type: [Schema.Types.ObjectId], ref: 'MasterData', default: [] },
    states:        { type: [String], default: [] },
    industries:    { type: [Schema.Types.ObjectId], ref: 'MasterData', default: [] },
  },
  { _id: false }
);

// ── ComplianceRule Document Interface ─────────────────────────────────────────

export interface IComplianceRule extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;               // Unique rule code e.g. "FSSAI-ANNUAL-RENEWAL"
  description?: string;
  category: Ref<unknown>;     // → MasterData (category: compliance_category)
  legalReference?: string;

  // Direct applicability references
  applicableEntityTypes: Types.ObjectId[];
  applicableLocationTypes: Types.ObjectId[];
  applicableStates: string[];

  // Backward-compatible embedded object
  applicability: IApplicability;

  // Frequency & Renewal
  frequency: Ref<unknown>;    // → MasterData (category: compliance_frequency)
  renewalFrequency?: string;  // Frequency code/string e.g. "ANNUALLY"
  renewalCycle: number;       // Renewal cycle in days, e.g. 365
  reminderDaysBefore: number[]; // e.g. [90, 60, 30, 15, 7]

  // Requirements & Workflow
  requiredDocuments: IRequiredDocumentConfig[];
  mandatory: boolean;         // Mandatory vs Recommended compliance
  active: boolean;            // Active flag
  status: ActiveStatus;       // 'active' | 'inactive' | 'archived'

  // Advanced Rules
  notificationRules: INotificationRuleConfig;
  escalationRules: IEscalationRuleConfig;

  requiresApproval: boolean;
  approvalLevels: number;
  priority: 'low' | 'medium' | 'high' | 'critical';

  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const complianceRuleSchema = new Schema<IComplianceRule>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    description:    { type: String, trim: true },
    category:       { type: Schema.Types.ObjectId, ref: 'MasterData', required: true },
    legalReference: { type: String, trim: true },

    // Direct applicability fields
    applicableEntityTypes:   { type: [Schema.Types.ObjectId], ref: 'MasterData', default: [] },
    applicableLocationTypes: { type: [Schema.Types.ObjectId], ref: 'MasterData', default: [] },
    applicableStates:        { type: [String], default: [] },

    applicability: { type: applicabilitySchema, default: () => ({}) },

    // Frequency reference
    frequency: { type: Schema.Types.ObjectId, ref: 'MasterData', required: true },
    renewalFrequency: { type: String, default: 'ANNUALLY' },
    renewalCycle: { type: Number, default: 365, min: 1 }, // in days
    reminderDaysBefore: {
      type: [Number],
      default: [90, 60, 30, 15, 7],
    },

    requiredDocuments: { type: [requiredDocumentConfigSchema], default: [] },
    mandatory: { type: Boolean, default: true },
    active:    { type: Boolean, default: true },

    notificationRules: {
      type: notificationRuleConfigSchema,
      default: () => ({
        reminderDays: [90, 60, 30, 15, 7],
        notifyRoles: ['unit_manager', 'compliance_officer'],
        channels: ['email', 'in_app'],
      }),
    },

    escalationRules: {
      type: escalationRuleConfigSchema,
      default: () => ({
        escalateAfterDays: 7,
        escalateToRole: 'entity_admin',
        autoTaskCreation: true,
      }),
    },

    requiresApproval: { type: Boolean, default: false },
    approvalLevels:   { type: Number, default: 1, min: 1, max: 5 },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Pre-save middleware: Synchronize applicability fields ─────────────────────
complianceRuleSchema.pre('save', function (next) {
  // Sync direct fields into applicability subdocument and vice-versa
  if (this.applicableEntityTypes && this.applicableEntityTypes.length > 0) {
    if (!this.applicability) (this as any).applicability = {};
    this.applicability.entityTypes = this.applicableEntityTypes;
  } else if (this.applicability?.entityTypes?.length) {
    this.applicableEntityTypes = this.applicability.entityTypes;
  }

  if (this.applicableLocationTypes && this.applicableLocationTypes.length > 0) {
    if (!this.applicability) (this as any).applicability = {};
    this.applicability.locationTypes = this.applicableLocationTypes;
  } else if (this.applicability?.locationTypes?.length) {
    this.applicableLocationTypes = this.applicability.locationTypes;
  }

  if (this.applicableStates && this.applicableStates.length > 0) {
    if (!this.applicability) (this as any).applicability = {};
    this.applicability.states = this.applicableStates;
  } else if (this.applicability?.states?.length) {
    this.applicableStates = this.applicability.states;
  }

  // Sync active flag with status
  if (this.status === 'active') {
    this.active = true;
  } else {
    this.active = false;
  }

  next();
});

// ── Indexes ────────────────────────────────────────────────────────────────────
complianceRuleSchema.index({ category: 1, status: 1 });
complianceRuleSchema.index({ frequency: 1 });
complianceRuleSchema.index({ priority: 1 });
complianceRuleSchema.index({ applicableEntityTypes: 1 });
complianceRuleSchema.index({ applicableLocationTypes: 1 });
complianceRuleSchema.index({ applicableStates: 1 });
complianceRuleSchema.index({ mandatory: 1 });
complianceRuleSchema.index({ active: 1 });

const ComplianceRule: Model<IComplianceRule> = mongoose.model<IComplianceRule>(
  'ComplianceRule',
  complianceRuleSchema
);

export default ComplianceRule;
