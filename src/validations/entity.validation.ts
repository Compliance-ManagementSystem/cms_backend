/**
 * Entity Validation Schemas using Zod
 */

import { z } from 'zod';

const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Address line 1 is required'),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1, 'City is required'),
  district: z.string().trim().optional(),
  state: z.string().trim().min(1, 'State is required'),
  pincode: z.string().trim().optional(),
  country: z.string().trim().default('India'),
});

export const createEntitySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Entity name must be at least 2 characters').max(150),
    code: z
      .string()
      .trim()
      .min(2, 'Entity code must be at least 2 characters')
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/, 'Code must be alphanumeric with dashes or underscores')
      .transform((val) => val.toUpperCase())
      .optional(),
    entityCode: z
      .string()
      .trim()
      .min(2, 'Entity code must be at least 2 characters')
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/, 'Code must be alphanumeric with dashes or underscores')
      .transform((val) => val.toUpperCase())
      .optional(),
    entityType: z.string().trim().min(1, 'Entity type is required'),
    owner: z.string().trim().optional().nullable(),
    registrationNumber: z.string().trim().optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
      .optional()
      .or(z.literal('')),
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
      .optional()
      .or(z.literal('')),
    cin: z.string().trim().toUpperCase().optional().or(z.literal('')),
    address: addressSchema,
    contactEmail: z.string().trim().toLowerCase().email('Invalid contact email'),
    contactPhone: z.string().trim().min(6, 'Valid phone number is required'),
    contactPerson: z.string().trim().optional(),
    description: z.string().trim().optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional().default('active'),
  }).refine((data) => data.code || data.entityCode, {
    message: 'Either code or entityCode is required',
    path: ['code'],
  }),
});

export const updateEntitySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(150).optional(),
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((val) => val.toUpperCase())
      .optional(),
    entityCode: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((val) => val.toUpperCase())
      .optional(),
    entityType: z.string().trim().optional(),
    owner: z.string().trim().optional().nullable(),
    registrationNumber: z.string().trim().optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
      .optional()
      .or(z.literal('')),
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
      .optional()
      .or(z.literal('')),
    cin: z.string().trim().toUpperCase().optional().or(z.literal('')),
    address: addressSchema.optional(),
    contactEmail: z.string().trim().toLowerCase().email().optional(),
    contactPhone: z.string().trim().optional(),
    contactPerson: z.string().trim().optional(),
    description: z.string().trim().optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
});
