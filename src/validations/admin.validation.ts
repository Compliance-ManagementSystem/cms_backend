
/**
 * Admin Module Validation Schemas using Zod
 */

import { z } from 'zod';

export const createUserSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, 'First name is required').max(50),
    lastName: z.string().trim().min(1, 'Last name is required').max(50),
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    role: z.string().trim().min(1, 'Role ID is required'),
    entity: z.string().trim().optional().nullable(),
    phone: z.string().trim().optional(),
    status: z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, 'First name is required').max(50).optional(),
    lastName: z.string().trim().min(1, 'Last name is required').max(50).optional(),
    email: z.string().trim().toLowerCase().email('Invalid email address format').optional(),
    role: z.string().trim().optional(),
    entity: z.string().trim().optional().nullable(),
    phone: z.string().trim().optional(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .optional()
      .or(z.literal('')),
  }),
});

export const userStatusSchema = z.object({
  body: z.object({
    status: z.enum(['active', 'inactive', 'suspended']),
  }),
});

export const createRoleSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Role name is required').max(100),
    code: z
      .string()
      .trim()
      .min(2, 'Role code is required')
      .max(50)
      .regex(/^[a-z0-9_]+$/, 'Code must be lowercase alphanumeric with underscores'),
    description: z.string().trim().optional(),
    permissions: z
      .array(
        z.object({
          resource: z.string().trim().min(1, 'Resource is required'),
          actions: z.array(z.string().trim().min(1)).min(1, 'At least one action is required'),
        })
      )
      .default([]),
  }),
});

export const updateRoleSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().optional(),
    permissions: z
      .array(
        z.object({
          resource: z.string().trim().min(1),
          actions: z.array(z.string().trim().min(1)).min(1),
        })
      )
      .optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }),
});

export const createPermissionSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Permission name is required').max(100),
    code: z
      .string()
      .trim()
      .min(2, 'Permission code is required')
      .regex(/^[a-z0-9_]+:[a-z0-9_]+$/, 'Code format must be "resource:action" (e.g., user:create)'),
    module: z.string().trim().min(2, 'Module name is required'),
    action: z.string().trim().min(2, 'Action is required'),
    description: z.string().trim().optional(),
  }),
});

export const createMasterDataSchema = z.object({
  body: z.object({
    category: z
      .string()
      .trim()
      .min(2, 'Category is required')
      .max(50)
      .regex(/^[a-z0-9_]+$/, 'Category must be lowercase alphanumeric with underscores'),
    code: z.string().trim().min(1, 'Code is required').max(50).toUpperCase(),
    label: z.string().trim().min(1, 'Label is required').max(150),
    description: z.string().trim().optional(),
    parent: z.string().trim().optional().nullable(),
    sortOrder: z.coerce.number().optional().default(0),
    metadata: z.record(z.unknown()).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional().default('active'),
  }),
});

export const updateMasterDataSchema = z.object({
  body: z.object({
    label: z.string().trim().min(1, 'Label is required').max(150).optional(),
    description: z.string().trim().optional(),
    parent: z.string().trim().optional().nullable(),
    sortOrder: z.coerce.number().optional(),
    metadata: z.record(z.unknown()).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
});

export const updateSettingsSchema = z.object({
  body: z.object({
    notifications: z
      .object({
        emailEnabled: z.boolean().optional(),
        whatsappEnabled: z.boolean().optional(),
        smsEnabled: z.boolean().optional(),
        defaultReminderDays: z.array(z.number()).optional(),
      })
      .optional(),
    config: z.record(z.unknown()).optional(),
    workflows: z
      .array(
        z.object({
          name: z.string().min(1),
          code: z.string().min(1),
          isActive: z.boolean().optional(),
          steps: z.array(
            z.object({
              step: z.number(),
              name: z.string(),
              role: z.string(),
              isRequired: z.boolean().optional(),
              canDelegate: z.boolean().optional(),
              slaHours: z.number().optional(),
            })
          ),
        })
      )
      .optional(),
  }),
});
