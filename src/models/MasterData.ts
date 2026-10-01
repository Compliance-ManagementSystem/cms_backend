/**
 * MasterData Model
 *
 * Generic extensible lookup table for application-wide classification:
 *   - entity_type
 *   - location_type
 *   - compliance_category
 *   - compliance_frequency
 *   - document_type
 *   - licence_type
 *   - task_priority
 *   - task_status
 *   - notification_rule
 *   - state
 *   - district
 *   - industry, approval_type, country, city...
 *
 * Fully editable via Admin panel.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';

export type MasterDataCategory =
  | 'entity_type'
  | 'location_type'
  | 'compliance_category'
  | 'compliance_frequency'
  | 'document_type'
  | 'licence_type'
  | 'task_priority'
  | 'task_status'
  | 'notification_rule'
  | 'state'
  | 'district'
  | 'approval_type'
  | 'industry'
  | 'country'
  | 'city'
  | string;

export interface IMasterData extends Document {
  _id: Types.ObjectId;
  category: MasterDataCategory;
  code: string;        // Unique within category
  label: string;
  description?: string;
  parent?: Ref<unknown>;   // → MasterData (e.g. district → state)
  sortOrder: number;
  metadata?: Record<string, unknown>;
  status: ActiveStatus;
  isSystem?: boolean;
  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const masterDataSchema = new Schema<IMasterData>(
  {
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_]+$/, 'Category must be lowercase alphanumeric with underscores'],
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    parent: { type: Schema.Types.ObjectId, ref: 'MasterData' },
    sortOrder: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    isSystem: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
masterDataSchema.index({ category: 1, code: 1 }, { unique: true });
masterDataSchema.index({ category: 1, status: 1 });
masterDataSchema.index({ parent: 1 });

const MasterData: Model<IMasterData> = mongoose.model<IMasterData>(
  'MasterData',
  masterDataSchema
);
export default MasterData;
