/**
 * Licence Validation Schemas
 *
 * Licence requests are multipart (an optional certificate file travels with the
 * fields), so every value arrives as a string.
 */

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const licenceFields = z.object({
  location: objectId,
  licenceType: objectId,
  licenceNumber: z.string().trim().min(1, 'Licence number is required').max(100),
  issuingAuthority: z.string().trim().min(1, 'Issuing authority is required').max(200),
  issuingState: z.string().trim().max(100).optional(),
  issueDate: dateString,
  expiryDate: dateString,
  status: z.enum(['active', 'pending_renewal', 'cancelled', 'suspended']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const validDateOrder = (value: { issueDate?: string; expiryDate?: string }) =>
  !value.issueDate || !value.expiryDate || new Date(value.expiryDate) > new Date(value.issueDate);
const dateOrderMessage = { message: 'Expiry date must be after the issue date', path: ['expiryDate'] };

export const createLicenceSchema = licenceFields.refine(validDateOrder, dateOrderMessage);

// The location of a licence does not change after it is created
export const updateLicenceSchema = licenceFields
  .omit({ location: true })
  .partial()
  .refine(validDateOrder, dateOrderMessage);
