/**
 * EntityType Model
 *
 * Distinct legal/organizational structure types for entities.
 * (e.g. Private Limited, Public Limited, LLP, Partnership, Healthcare Group).
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus } from '../types/models.js';

export interface IEntityTypeDoc extends Document {
  _id: Types.ObjectId;
  name: string;        // e.g. "Private Limited Company"
  code: string;        // e.g. "PVT_LTD", "LLP", "CCPL"
  description?: string;
  industry?: string;
  isSystem: boolean;
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const entityTypeSchema = new Schema<IEntityTypeDoc>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9_-]+$/, 'Code must be uppercase alphanumeric'],
    },
    description: { type: String, default: '' },
    industry: { type: String, trim: true },
    isSystem: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true }
);

entityTypeSchema.index({ status: 1 });

const EntityType: Model<IEntityTypeDoc> = mongoose.model<IEntityTypeDoc>('EntityType', entityTypeSchema);
export default EntityType;
