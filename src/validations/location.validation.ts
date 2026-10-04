import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
// The forms send an empty value as null or '' when nothing is selected
const optionalRef = objectId.or(z.literal('')).nullable().optional();

export const locationAddressSchema = z.object({
  line1: z.string().trim().min(1, 'Address line 1 is required'),
  line2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  district: z.string().trim().optional(),
  state: z.string().trim().min(1, 'State is required'),
  pincode: z.string().trim().optional(),
  country: z.string().trim().default('India'),
});

export const locationAgreementSchema = z
  .object({
    agreementType: z.string().trim().min(1, 'Agreement type is required'),
    agreementNumber: z.string().trim().min(1, 'Agreement number is required'),
    startDate: dateString,
    endDate: dateString,
    renewalDate: dateString.or(z.literal('')).nullable().optional(),
    parties: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  })
  .passthrough()
  .refine((agr) => new Date(agr.endDate) >= new Date(agr.startDate), {
    message: 'Agreement end date cannot be before its start date',
  });

export const locationCoEntitySchema = z.object({
  entity: objectId,
  openingDate: dateString.or(z.literal('')).nullable().optional(),
});

// Selects send '' when cleared
const areaType = z.enum(['GP', 'NAC', 'MUN']).or(z.literal('')).nullable().optional();
const operatingModel = z.enum(['CoCo', 'CoDo']).or(z.literal('')).nullable().optional();

export const createLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(200),
  code: z.string().trim().max(50).optional(),
  locationCode: z.string().trim().max(50).optional(),
  entity: objectId,
  locationType: z.string().trim().min(1, 'Location type is required'), // Master Data id or code
  address: locationAddressSchema,
  contactPerson: z.string().trim().optional(),
  contactEmail: z.string().trim().email('Invalid email address').optional().or(z.literal('')),
  contactPhone: z.string().trim().optional(),
  manager: optionalRef,
  openingDate: dateString.or(z.literal('')).nullable().optional(),
  closingDate: dateString.or(z.literal('')).nullable().optional(),
  areaType,
  operatingModel,
  coEntities: z.array(locationCoEntitySchema).optional(),
  description: z.string().trim().optional(),
  area: z.number().min(0).nullable().optional(),
  areaUnit: z.enum(['sqft', 'sqm']).optional(),
  operatingHours: z.string().trim().optional(),
  parentLocation: optionalRef,
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  agreements: z.array(locationAgreementSchema).optional(),
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
  areaType: z.enum(['GP', 'NAC', 'MUN']).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  attention: z.enum(['true', 'false']).optional(), // only locations with expired compliance
  sortBy: z.enum(['name', 'code', 'status', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationQueryInput = z.infer<typeof locationQuerySchema>;
