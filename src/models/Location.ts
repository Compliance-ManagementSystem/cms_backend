/**
 * Location Model
 *
 * A physical unit/clinic/office belonging to an Entity.
 * Maps to: Unit – Clinic – Office as per the reference workflow.
 *
 * Each Location can have many:
 *   - Agreements
 *   - KYC / property docs (via Document model)
 *   - Licences & Approvals
 *   - ComplianceRecords
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ActiveStatus, Ref } from '../types/models.js';
import type { IAddress } from './Entity.js';

// Re-use the embedded address schema shape
const locationAddressSchema = new Schema<IAddress>(
  {
    line1:   { type: String, required: true, trim: true },
    line2:   { type: String, trim: true },
    city:    { type: String, required: true, trim: true },
    district:{ type: String, trim: true },
    state:   { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'India' },
  },
  { _id: false }
);

// ── Agreement (embedded) ───────────────────────────────────────────────────────

export interface IAgreement {
  agreementType: string;        // e.g. "lease", "license", "mou"
  agreementNumber: string;
  startDate: Date;
  endDate: Date;
  renewalDate?: Date;
  parties: string[];            // Names of parties involved
  documentRef?: Ref<unknown>;   // → Document
  notes?: string;
}

const agreementSchema = new Schema<IAgreement>(
  {
    agreementType:   { type: String, required: true, trim: true },
    agreementNumber: { type: String, required: true, trim: true },
    startDate:       { type: Date, required: true },
    endDate:         { type: Date, required: true },
    renewalDate:     { type: Date },
    parties:         { type: [String], default: [] },
    documentRef:     { type: Schema.Types.ObjectId, ref: 'Document' },
    notes:           { type: String },
  },
  { _id: true, timestamps: false }
);

// ── Location document ──────────────────────────────────────────────────────────

export interface ILocation extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;               // Unique within entity, e.g. "LOC-001"
  locationCode?: string;      // Virtual alias
  entity: Ref<unknown>;       // → Entity (required)
  locationType: Ref<unknown>; // → MasterData (category: location_type)
  address: IAddress;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  manager?: Ref<unknown>;     // → User (unit/location manager)
  openingDate?: Date;
  description?: string;
  area?: number;              // Square feet / meters
  areaUnit?: 'sqft' | 'sqm';
  operatingHours?: string;
  agreements: IAgreement[];
  parentLocation?: Ref<unknown>; // → Location (for sub-units)
  geoCoordinates?: {
    latitude: number;
    longitude: number;
  };
  status: ActiveStatus;
  createdBy?: Ref<unknown>;
  updatedBy?: Ref<unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ILocation>(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    entity: {
      type: Schema.Types.ObjectId,
      ref: 'Entity',
      required: true,
    },
    locationType: {
      type: Schema.Types.ObjectId,
      ref: 'MasterData',
      required: true,
    },
    address: { type: locationAddressSchema, required: true },
    contactPerson:  { type: String, trim: true },
    contactEmail:   { type: String, lowercase: true, trim: true },
    contactPhone:   { type: String, trim: true },
    manager:        { type: Schema.Types.ObjectId, ref: 'User' },
    openingDate:    { type: Date },
    description:    { type: String, trim: true },
    area:           { type: Number, min: 0 },
    areaUnit:       { type: String, enum: ['sqft', 'sqm'], default: 'sqft' },
    operatingHours: { type: String },
    agreements:     { type: [agreementSchema], default: [] },
    parentLocation: { type: Schema.Types.ObjectId, ref: 'Location' },
    geoCoordinates: {
      latitude:  { type: Number },
      longitude: { type: Number },
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

// Virtual for locationCode
locationSchema.virtual('locationCode').get(function () {
  return this.code;
});

// ── Compound unique: code unique per entity ────────────────────────────────────
locationSchema.index({ entity: 1, code: 1 }, { unique: true });
locationSchema.index({ entity: 1, status: 1 });
locationSchema.index({ locationType: 1 });
locationSchema.index({ parentLocation: 1 });
locationSchema.index({ 'agreements.endDate': 1 }); // For expiry queries

const Location: Model<ILocation> = mongoose.model<ILocation>(
  'Location',
  locationSchema
);
export default Location;
