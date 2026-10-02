import { z } from 'zod';

export const requiredDocumentSchema = z.object({
  documentType: z.string().min(1, 'Document type is required').trim(),
  label: z.string().min(1, 'Document label is required').trim(),
  isMandatory: z.boolean().default(true),
});

export const notificationRulesSchema = z.object({
  reminderDays: z.array(z.number().int().positive()).default([90, 60, 30, 15, 7]),
  notifyRoles: z.array(z.string()).default(['location_manager', 'compliance_officer']),
  channels: z.array(z.string()).default(['email', 'in_app']),
});

export const escalationRulesSchema = z.object({
  escalateAfterDays: z.number().int().min(0).default(7),
  escalateToRole: z.string().default('entity_admin'),
  autoTaskCreation: z.boolean().default(true),
  escalationMessage: z.string().optional(),
});

export const createComplianceRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required').max(200).trim(),
  code: z
    .string()
    .max(60)
    .trim()
    .toUpperCase()
    .optional(),
  description: z.string().trim().optional(),
  category: z.string().min(1, 'Compliance category is required').trim(),
  legalReference: z.string().trim().optional(),
  applicableEntityTypes: z.array(z.string()).default([]),
  applicableLocationTypes: z.array(z.string()).default([]),
  applicableStates: z.array(z.string()).default([]),
  frequency: z.string().min(1, 'Compliance frequency is required').trim(),
  renewalFrequency: z.string().optional(),
  // Allow 0 for one-time (ONETIME) compliance rules — was .positive() which blocked 0
  renewalCycle: z.coerce.number().int().min(0).max(36500).default(365),
  requiredDocuments: z.array(requiredDocumentSchema).default([]),
  mandatory: z.boolean().default(true),
  active: z.boolean().default(true),
  notificationRules: notificationRulesSchema.optional(),
  escalationRules: escalationRulesSchema.optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  requiresApproval: z.boolean().default(false),
  approvalLevels: z.number().int().min(1).max(5).default(1),
});

export const updateComplianceRuleSchema = createComplianceRuleSchema.partial();

export const complianceRuleQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  frequency: z.string().trim().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  mandatory: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  entityType: z.string().trim().optional(),
  locationType: z.string().trim().optional(),
  state: z.string().trim().optional(),
  sortBy: z.enum(['name', 'code', 'category', 'priority', 'status', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const evaluateRuleSchema = z.object({
  ruleId: z.string().optional(),
  entityId: z.string().optional(),
  locationId: z.string().optional(),
});

export type CreateComplianceRuleInput = z.infer<typeof createComplianceRuleSchema>;
export type UpdateComplianceRuleInput = z.infer<typeof updateComplianceRuleSchema>;
export type ComplianceRuleQueryInput = z.infer<typeof complianceRuleQuerySchema>;
