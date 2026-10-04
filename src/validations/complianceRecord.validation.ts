/**
 * Compliance Record Validation Schemas
 */

import { z } from 'zod';

const dateInput = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));
// Forms send '' or null to clear a date
const clearableDate = dateInput.or(z.literal('')).nullable().optional();

export const createComplianceRecordSchema = z.object({
  entity: z.string().min(1, 'Entity ID is required'),
  location: z.string().min(1, 'Location ID is required'),
  rule: z.string().min(1, 'Compliance Rule ID is required'),
  assignedUser: z.string().optional(),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  expiryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  comments: z.string().optional(),
  notes: z.string().optional(),
});

export const updateComplianceRecordSchema = createComplianceRecordSchema.partial().extend({
  licenceNumber: z.string().trim().max(100).optional(),
  issueDate: clearableDate,
  submissionDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  approvalDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
});

export const updateComplianceStatusSchema = z.object({
  status: z.enum([
    'pending',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'correction',
    'resubmitted',
    'expiring_soon',
    'expired',
    'in_progress',
    'not_applicable',
  ]),
  comments: z.string().optional(),
  // Licence details can be saved together with the status
  licenceNumber: z.string().trim().max(100).optional(),
  issueDate: clearableDate,
  expiryDate: clearableDate,
  decision: z.enum(['pending', 'approved', 'rejected', 'escalated']).optional(),
});

export const executeWorkflowActionSchema = z.object({
  action: z.enum([
    'Submit',
    'Start Review',
    'Approve',
    'Reject',
    'Request Correction',
    'Resubmit',
  ]),
  comments: z.string().optional(),
});

export const complianceRecordQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  entity: z.string().optional(),
  location: z.string().optional(),
  rule: z.string().optional(),
  status: z.string().optional(), // single status or comma-separated list
  overdue: z.enum(['true', 'false']).optional(),
  assignedUser: z.string().optional(),
  dueDateFrom: z.string().optional(),
  dueDateTo: z.string().optional(),
  expiryDateFrom: z.string().optional(),
  expiryDateTo: z.string().optional(),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
