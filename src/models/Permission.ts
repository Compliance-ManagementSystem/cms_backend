/**
 * Permission Model
 *
 * Granular system permissions catalog.
 * Represents an individual permission (e.g. entity:create, compliance:approve).
 * Can be linked to Roles either by reference or via Role.permissions subdocument.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus } from '../types/models.js';

export interface IPermissionDoc extends Document {
  _id: Types.ObjectId;
  name: string;        // Human-readable: "Create Compliance Record"
  code: string;        // Code slug: "compliance_record:create"
  module: string;      // e.g. "entity", "location", "compliance", "task", "audit"
  action: string;      // e.g. "create", "read", "update", "delete", "approve"
  description?: string;
  isSystem: boolean;   // System permissions cannot be deleted
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const permissionSchema = new Schema<IPermissionDoc>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_:]+$/, 'Code must be lowercase alphanumeric with underscores or colons'],
    },
    module: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    isSystem: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true }
);

permissionSchema.index({ module: 1, action: 1 });
permissionSchema.index({ status: 1 });

const Permission: Model<IPermissionDoc> = mongoose.model<IPermissionDoc>('Permission', permissionSchema);
export default Permission;
