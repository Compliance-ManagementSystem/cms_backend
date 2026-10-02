/**
 * Task Validation Schemas
 */

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

// "overdue" is derived from the due date and cannot be set as a status
export const taskStatusSchema = z.enum([
  'open',
  'in_progress',
  'pending_approval',
  'completed',
  'cancelled',
]);

const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().optional(),
  entity: objectId.optional(), // inherited from the compliance record when one is linked
  location: objectId.optional(),
  complianceRecord: objectId.optional(),
  assignedTo: objectId,
  priority: taskPrioritySchema.default('medium'),
  dueDate: dateString,
  taskType: z.enum(['renewal', 'approval', 'document_upload', 'inspection', 'manual']).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  assignedTo: objectId.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: dateString.optional(),
  status: taskStatusSchema.optional(),
});

export const addTaskCommentSchema = z.object({
  text: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});

export const updateTaskStatusSchema = z.object({
  status: taskStatusSchema,
});

export const taskQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  entity: objectId.optional(),
  location: objectId.optional(),
  complianceRecord: objectId.optional(),
  assignedTo: objectId.optional(),
  overdueOnly: z.enum(['true', 'false']).optional(),
  sortBy: z.string().default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
