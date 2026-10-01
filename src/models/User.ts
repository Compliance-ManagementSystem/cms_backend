/**
 * User Model
 *
 * Central user identity. References Role for RBAC.
 * References Entity for entity-scoped users (null = national/super admin).
 * Supports assignedLocations for Location Managers.
 * Passwords are automatically hashed via bcrypt pre-save hook.
 */

import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import type { ActiveStatus, Ref } from '../types/models.js';

// ── User document ─────────────────────────────────────────────────────────────

export interface IUser extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone?: string;
  password: string;            // bcrypt hash — select:false
  role: Ref<unknown>;          // → Role
  entity?: Ref<unknown>;       // → Entity (null for super admins)
  assignedLocations?: Ref<unknown>[]; // → Location[] (for location managers)
  department?: string;
  designation?: string;
  avatar?: string;             // URL or file path
  isEmailVerified: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  refreshToken?: string;       // select:false
  status: ActiveStatus;
  createdBy?: Ref<unknown>;    // → User
  updatedBy?: Ref<unknown>;    // → User
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      match: [/^\+?[\d\s\-().]{7,20}$/, 'Please provide a valid phone number'],
    },
    password: {
      type: String,
      required: true,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },
    entity: {
      type: Schema.Types.ObjectId,
      ref: 'Entity',
      default: null,
    },
    assignedLocations: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
      default: [],
    },
    department: { type: String, trim: true },
    designation: { type: String, trim: true },
    avatar: { type: String },
    isEmailVerified: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    refreshToken: { type: String, select: false },
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

// ── Virtuals ──────────────────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function (this: IUser) {
  return `${this.firstName} ${this.lastName}`.trim();
});

// ── Password hashing pre-save hook ───────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const saltRounds = 10;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// ── Method to verify password ────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (
  this: IUser,
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── Indexes ───────────────────────────────────────────────────────────────────
// Note: { email: 1 } unique index is declared on the field itself
userSchema.index({ role: 1 });
userSchema.index({ entity: 1 });
userSchema.index({ status: 1 });

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
export default User;
