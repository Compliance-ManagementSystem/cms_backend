/**
 * LocationType Model
 *
 * Categorization of physical operating locations.
 * (e.g. Unit, Clinic, Office, Hospital, Diagnostic Lab, Warehouse).
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus } from '../types/models.js';

export interface ILocationTypeDoc extends Document {
  _id: Types.ObjectId;
  name: string;        // e.g. "Clinic", "Diagnostic Unit", "Corporate Office"
  code: string;        // e.g. "CLINIC", "UNIT", "OFFICE"
  description?: string;
  isSystem: boolean;
  status: ActiveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const locationTypeSchema = new Schema<ILocationTypeDoc>(
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
    isSystem: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
  },
  { timestamps: true }
);

locationTypeSchema.index({ status: 1 });

const LocationType: Model<ILocationTypeDoc> = mongoose.model<ILocationTypeDoc>('LocationType', locationTypeSchema);
export default LocationType;
