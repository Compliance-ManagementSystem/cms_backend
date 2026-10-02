/**
 * Entity Validation Schemas using Zod
 */

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
// The forms send an empty value as null or '' when nothing is selected
const optionalRef = objectId.or(z.literal('')).nullable().optional();

const entityCode = z
  .string()
  .trim()
  .min(2, 'Entity code must be at least 2 characters')
  .max(20, 'Entity code must be at most 20 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Code may only contain letters, numbers, dashes and underscores');

const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Address line 1 is required'),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1, 'City is required'),
  district: z.string().trim().optional(),
  state: z.string().trim().min(1, 'State is required'),
  pincode: z.string().trim().optional(),
  country: z.string().trim().default('India'),
});

const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
  .optional()
  .or(z.literal(''));

const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
  .optional()
  .or(z.literal(''));

const entityFields = {
  // Left blank, a code is generated from the name
  code: entityCode.optional().or(z.literal('')),
  entityCode: entityCode.optional().or(z.literal('')),
  owner: optionalRef,
  registrationNumber: z.string().trim().optional(),
  gstin,
  pan,
  cin: z.string().trim().toUpperCase().optional().or(z.literal('')),
  contactPerson: z.string().trim().optional(),
  industry: optionalRef,
  parentEntity: optionalRef,
  description: z.string().trim().optional(),
};

export const createEntitySchema = z.object({
  body: z.object({
    ...entityFields,
    name: z.string().trim().min(2, 'Entity name must be at least 2 characters').max(150),
    entityType: objectId,
    address: addressSchema,
    contactEmail: z.string().trim().toLowerCase().email('Invalid contact email'),
    contactPhone: z.string().trim().min(6, 'Valid phone number is required'),
    status: z.enum(['active', 'inactive', 'archived']).optional().default('active'),
  }),
});

export const updateEntitySchema = z.object({
  body: z.object({
    ...entityFields,
    name: z.string().trim().min(2, 'Entity name must be at least 2 characters').max(150).optional(),
    entityType: objectId.optional(),
    address: addressSchema.optional(),
    contactEmail: z.string().trim().toLowerCase().email('Invalid contact email').optional(),
    contactPhone: z.string().trim().min(6, 'Valid phone number is required').optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
});

export const entityQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().optional(),
  entityType: objectId.optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  state: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().optional(),
  attention: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'code', 'status', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
