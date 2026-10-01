import { z } from 'zod';

export const locationAddressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required').trim(),
  line2: z.string().trim().optional(),
  city: z.string().min(1, 'City is required').trim(),
  district: z.string().trim().optional(),
  state: z.string().min(1, 'State is required').trim(),
  pincode: z.string().trim().optional(),
  country: z.string().trim().default('India'),
});

export const createLocationSchema = z.object({
  name: z.string().min(1, 'Location name is required').max(200).trim(),
  code: z
    .string()
    .max(50)
    .trim()
    .toUpperCase()
    .optional(),
  locationCode: z
    .string()
    .max(50)
    .trim()
    .toUpperCase()
    .optional(),
  entity: z.string().min(1, 'Entity is required').trim(),
  locationType: z.string().min(1, 'Location type is required').trim(),
  address: locationAddressSchema,
  contactPerson: z.string().trim().optional(),
  contactEmail: z.string().email('Invalid email address').trim().optional().or(z.literal('')),
  contactPhone: z.string().trim().optional(),
  manager: z.string().trim().optional().nullable(),
  openingDate: z.string().or(z.date()).optional().nullable(),
  description: z.string().trim().optional(),
  area: z.number().min(0).optional().nullable(),
  areaUnit: z.enum(['sqft', 'sqm']).optional(),
  operatingHours: z.string().trim().optional(),
  parentLocation: z.string().trim().optional().nullable(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
});

export const updateLocationSchema = createLocationSchema.partial();

export const locationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  locationType: z.string().trim().optional(),
  state: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  sortBy: z.enum(['name', 'code', 'status', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationQueryInput = z.infer<typeof locationQuerySchema>;
