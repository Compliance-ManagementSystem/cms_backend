/**
 * Compliance Rule Controller
 *
 * CRUD, search, status changes and applicability evaluation for compliance rules.
 * Every Master Data reference is checked against its category before it is stored.
 */

import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import ComplianceRule, { IComplianceRule } from '../models/ComplianceRule.js';
import MasterData from '../models/MasterData.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import { RuleEngineService } from '../services/ruleEngine.service.js';
import { auditService } from '../services/audit.service.js';
import { ROLES } from '../constants/permissions.js';
import { complianceRuleQuerySchema } from '../validations/complianceRule.validation.js';
import { assertInScope } from '../utils/accessScope.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const actorId = (req: Request) => req.user?._id || req.auth?.userId;

const VALID_ROLES: string[] = Object.values(ROLES);
const VALID_CHANNELS = ['email', 'in_app', 'sms', 'whatsapp'];
// Older rules were saved with a role code that never existed
const LEGACY_ROLES: Record<string, string> = { unit_manager: ROLES.LOCATION_MANAGER };

/** Finds a Master Data item of the given category by id or code; rejects anything else */
const resolveMasterData = async (category: string, input: unknown, label: string) => {
  const value = String(input ?? '').trim();
  if (!value) throw ApiError.badRequest(`${label} is required.`);

  const item = mongoose.Types.ObjectId.isValid(value)
    ? await MasterData.findOne({ _id: value, category })
    : await MasterData.findOne({ category, code: value.toUpperCase() });
  if (!item) throw ApiError.badRequest(`${label} "${value}" was not found in Master Data.`);
  return item;
};

const resolveMasterDataIds = async (category: string, inputs: unknown[], label: string) => {
  const ids = new Map<string, Types.ObjectId>();
  for (const input of inputs) {
    const item = await resolveMasterData(category, input, label);
    ids.set(item._id.toString(), item._id as Types.ObjectId);
  }
  return [...ids.values()];
};

/** States are stored by name; each must be a state known to Master Data */
const resolveStates = async (inputs: unknown[]) => {
  if (inputs.length === 0) return [];
  const known = await MasterData.find({ category: 'state' }).select('code label').lean();
  const names = new Set<string>();
  for (const input of inputs) {
    const value = String(input ?? '').trim();
    if (!value) continue;
    const match = known.find(
      (state) => state.label.toLowerCase() === value.toLowerCase() || state.code.toLowerCase() === value.toLowerCase()
    );
    if (!match) throw ApiError.badRequest(`State "${value}" was not found in Master Data.`);
    names.add(match.label);
  }
  return [...names];
};

const resolveRequiredDocuments = async (docs: any[]) => {
  const resolved: Array<{ documentType: Types.ObjectId; label: string; isMandatory: boolean }> = [];
  for (const doc of docs) {
    const type = await resolveMasterData('document_type', doc?.documentType, 'Document type');
    resolved.push({
      documentType: type._id as Types.ObjectId,
      label: String(doc.label || '').trim() || type.label,
      isMandatory: doc.isMandatory !== undefined ? Boolean(doc.isMandatory) : true,
    });
  }
  return resolved;
};

const resolveRole = (input: unknown, label: string) => {
  const value = String(input ?? '').trim();
  const role = LEGACY_ROLES[value] || value;
  if (!VALID_ROLES.includes(role)) throw ApiError.badRequest(`${label} "${value}" is not a role in this system.`);
  return role;
};

const resolveNotificationRules = (input: any) => {
  const reminderDays = [...new Set<number>((input?.reminderDays ?? [90, 60, 30, 15, 7]).map(Number))];
  if (reminderDays.some((day) => !Number.isInteger(day) || day <= 0)) {
    throw ApiError.badRequest('Reminder days must be whole numbers greater than zero.');
  }
  const channels: string[] = [...new Set<string>(input?.channels ?? ['email', 'in_app'])];
  const unknownChannel = channels.find((channel) => !VALID_CHANNELS.includes(channel));
  if (unknownChannel) throw ApiError.badRequest(`Notification channel "${unknownChannel}" is not supported.`);

  const roles: unknown[] = input?.notifyRoles ?? [ROLES.LOCATION_MANAGER, ROLES.COMPLIANCE_OFFICER];
  return {
    reminderDays: reminderDays.sort((a, b) => b - a),
    notifyRoles: [...new Set(roles.map((role) => resolveRole(role, 'Notify role')))],
    channels,
  };
};

const resolveEscalationRules = (input: any) => {
  const escalateAfterDays = Number(input?.escalateAfterDays ?? 7);
  if (!Number.isInteger(escalateAfterDays) || escalateAfterDays < 0) {
    throw ApiError.badRequest('Escalation days must be a whole number, zero or more.');
  }
  return {
    escalateAfterDays,
    escalateToRole: resolveRole(input?.escalateToRole ?? ROLES.ENTITY_ADMIN, 'Escalation role'),
    autoTaskCreation: input?.autoTaskCreation !== undefined ? Boolean(input.autoTaskCreation) : true,
    escalationMessage: input?.escalationMessage ? String(input.escalationMessage).trim() : undefined,
  };
};

/** Renewal cycle in days; 0 means a one-time obligation */
const resolveRenewalCycle = (input: unknown) => {
  const cycle = Number(input);
  if (!Number.isInteger(cycle) || cycle < 0) {
    throw ApiError.badRequest('Renewal cycle must be a whole number of days, or 0 for a one-time rule.');
  }
  return cycle;
};

const assertCodeAvailable = async (code: string, excludeId?: Types.ObjectId) => {
  const clash = await ComplianceRule.findOne({ code, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('_id');
  if (clash) throw ApiError.conflict(`Compliance Rule with code "${code}" already exists`);
};

const generateRuleCode = async (categoryCode: string) => {
  const prefix = `RULE-${categoryCode.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'GEN'}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await ComplianceRule.exists({ code: candidate }))) return candidate;
  }
  return `${prefix}-${Date.now().toString().slice(-8)}`;
};

const idList = (values: unknown[] = []) => values.map((value) => String(value)).sort();

const auditSnapshot = (rule: IComplianceRule) => {
  const plain: any = rule.toObject({ virtuals: false });
  return {
    name: plain.name,
    code: plain.code,
    description: plain.description,
    legalReference: plain.legalReference,
    category: String(plain.category),
    frequency: String(plain.frequency),
    renewalCycle: plain.renewalCycle,
    applicableEntityTypes: idList(plain.applicableEntityTypes),
    applicableLocationTypes: idList(plain.applicableLocationTypes),
    applicableStates: [...(plain.applicableStates || [])].sort(),
    requiredDocuments: (plain.requiredDocuments || []).map((doc: any) => ({
      documentType: String(doc.documentType),
      label: doc.label,
      isMandatory: doc.isMandatory,
    })),
    mandatory: plain.mandatory,
    priority: plain.priority,
    status: plain.status,
    notificationRules: plain.notificationRules,
    escalationRules: plain.escalationRules,
    requiresApproval: plain.requiresApproval,
    approvalLevels: plain.approvalLevels,
  };
};

const logRuleAudit = (
  req: Request,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  rule: IComplianceRule,
  description: string,
  values: { previousValue?: Record<string, unknown>; newValue?: Record<string, unknown> } = {}
) =>
  auditService.logMutation({
    req,
    action,
    module: 'rules',
    entityType: 'ComplianceRule',
    recordId: rule._id,
    description,
    ...values,
  });

const populateRule = (id: Types.ObjectId) =>
  ComplianceRule.findById(id)
    .populate('category', 'code label')
    .populate('frequency', 'code label')
    .populate('applicableEntityTypes', 'code label')
    .populate('applicableLocationTypes', 'code label')
    .populate('requiredDocuments.documentType', 'code label')
    .lean();

const findRuleOrFail = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid Compliance Rule ID format');
  const rule = await ComplianceRule.findById(id);
  if (!rule) throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  return rule;
};

// ── 1. Get Paginated Compliance Rules ─────────────────────────────────────────
export const getComplianceRules = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, category, frequency, status, mandatory, state, entityType, locationType, sortBy, sortOrder } =
    complianceRuleQuerySchema.parse(req.query);

  // Filters other than status, which the summary counts are broken down by
  const conditions: Record<string, any>[] = [];

  // A filter value that matches nothing in Master Data must return no rules, not all of them
  const NO_MATCH = new Types.ObjectId();
  const lookupId = async (masterCategory: string, value: string) => {
    if (mongoose.Types.ObjectId.isValid(value)) return new Types.ObjectId(value);
    const item = await MasterData.findOne({ category: masterCategory, code: value.toUpperCase() }).select('_id');
    return (item?._id as Types.ObjectId) || NO_MATCH;
  };

  if (category) conditions.push({ category: await lookupId('compliance_category', category) });
  if (frequency) conditions.push({ frequency: await lookupId('compliance_frequency', frequency) });
  if (mandatory !== undefined) conditions.push({ mandatory });
  if (entityType) {
    // An empty list means the rule applies to every type
    const id = await lookupId('entity_type', entityType);
    conditions.push({ $or: [{ applicableEntityTypes: { $size: 0 } }, { applicableEntityTypes: id }] });
  }
  if (locationType) {
    const id = await lookupId('location_type', locationType);
    conditions.push({ $or: [{ applicableLocationTypes: { $size: 0 } }, { applicableLocationTypes: id }] });
  }
  if (state) {
    conditions.push({
      $or: [{ applicableStates: { $size: 0 } }, { applicableStates: new RegExp(`^${escapeRegex(state)}$`, 'i') }],
    });
  }
  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), 'i');
    conditions.push({
      $or: [{ name: searchRegex }, { code: searchRegex }, { description: searchRegex }, { legalReference: searchRegex }],
    });
  }

  const withConditions = (...extra: Record<string, any>[]) => {
    const all = [...conditions, ...extra];
    return all.length > 0 ? { $and: all } : {};
  };
  const query = withConditions(...(status ? [{ status }] : []));

  const [rules, total, activeCount, inactiveCount, archivedCount, mandatoryCount, categoryIds] = await Promise.all([
    ComplianceRule.find(query)
      .populate('category', 'code label description')
      .populate('frequency', 'code label')
      .populate('applicableEntityTypes', 'code label')
      .populate('applicableLocationTypes', 'code label')
      .populate('requiredDocuments.documentType', 'code label')
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ComplianceRule.countDocuments(query),
    // Status counts ignore the status filter itself so they stay meaningful as filter cards
    ComplianceRule.countDocuments(withConditions({ status: 'active' })),
    ComplianceRule.countDocuments(withConditions({ status: 'inactive' })),
    ComplianceRule.countDocuments(withConditions({ status: 'archived' })),
    ComplianceRule.countDocuments(withConditions(...(status ? [{ status }] : []), { mandatory: true })),
    ComplianceRule.distinct('category', query),
  ]);

  return ApiResponse.success(res, {
    rules,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    stats: {
      total,
      activeCount,
      inactiveCount,
      archivedCount,
      mandatoryCount,
      uniqueCategoriesCount: categoryIds.length,
    },
  });
});

// ── 2. Get Single Compliance Rule by ID ───────────────────────────────────────
export const getComplianceRuleById = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid Compliance Rule ID format');
  }

  const rule = await ComplianceRule.findById(id)
    .populate('category', 'code label description')
    .populate('frequency', 'code label description')
    .populate('applicableEntityTypes', 'code label description')
    .populate('applicableLocationTypes', 'code label description')
    .populate('requiredDocuments.documentType', 'code label description')
    .populate('createdBy', 'firstName lastName email')
    .populate('updatedBy', 'firstName lastName email')
    .lean();

  if (!rule) {
    throw ApiError.notFound(`Compliance Rule with ID "${id}" not found`);
  }

  return ApiResponse.success(res, { rule });
});

// ── 3. Create Compliance Rule ─────────────────────────────────────────────────
export const createComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;

  const category = await resolveMasterData('compliance_category', body.category, 'Compliance category');
  const frequency = await resolveMasterData('compliance_frequency', body.frequency, 'Compliance frequency');

  const code = String(body.code || '').trim().toUpperCase() || (await generateRuleCode(category.code));
  await assertCodeAvailable(code);

  const status = body.status || (body.active === false ? 'inactive' : 'active');

  const newRule = await ComplianceRule.create({
    name: String(body.name).trim(),
    code,
    description: body.description?.trim() || '',
    category: category._id,
    legalReference: body.legalReference?.trim() || '',
    applicableEntityTypes: await resolveMasterDataIds('entity_type', body.applicableEntityTypes || [], 'Entity type'),
    applicableLocationTypes: await resolveMasterDataIds('location_type', body.applicableLocationTypes || [], 'Location type'),
    applicableStates: await resolveStates(body.applicableStates || []),
    frequency: frequency._id,
    renewalFrequency: frequency.code,
    renewalCycle: resolveRenewalCycle(body.renewalCycle ?? 365),
    requiredDocuments: await resolveRequiredDocuments(body.requiredDocuments || []),
    mandatory: body.mandatory !== undefined ? Boolean(body.mandatory) : true,
    status,
    notificationRules: resolveNotificationRules(body.notificationRules),
    escalationRules: resolveEscalationRules(body.escalationRules),
    priority: body.priority || 'medium',
    requiresApproval: Boolean(body.requiresApproval),
    approvalLevels: Number(body.approvalLevels) || 1,
    createdBy: actorId(req),
    updatedBy: actorId(req),
  });

  await logRuleAudit(req, 'CREATE', newRule, `Created compliance rule "${newRule.name}" (${newRule.code})`, {
    newValue: auditSnapshot(newRule),
  });

  const rule = await populateRule(newRule._id);
  return ApiResponse.created(res, { rule }, 'Compliance rule created successfully');
});

// ── 4. Update Compliance Rule ─────────────────────────────────────────────────
export const updateComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await findRuleOrFail(String(req.params.id));
  const body = req.body;
  const previousValue = auditSnapshot(rule);

  if (body.category !== undefined) {
    rule.category = (await resolveMasterData('compliance_category', body.category, 'Compliance category'))._id;
  }
  if (body.frequency !== undefined) {
    const frequency = await resolveMasterData('compliance_frequency', body.frequency, 'Compliance frequency');
    rule.frequency = frequency._id;
    rule.renewalFrequency = frequency.code;
  }

  const code = String(body.code || '').trim().toUpperCase();
  if (code && code !== rule.code) {
    await assertCodeAvailable(code, rule._id);
    rule.code = code;
  }

  if (body.name !== undefined) rule.name = String(body.name).trim();
  if (body.description !== undefined) rule.description = body.description?.trim() || '';
  if (body.legalReference !== undefined) rule.legalReference = body.legalReference?.trim() || '';
  if (body.renewalCycle !== undefined) rule.renewalCycle = resolveRenewalCycle(body.renewalCycle);
  if (body.mandatory !== undefined) rule.mandatory = Boolean(body.mandatory);
  if (body.priority) rule.priority = body.priority;

  if (body.status !== undefined) rule.status = body.status;
  else if (body.active !== undefined) rule.status = body.active ? 'active' : 'inactive';

  if (body.applicableEntityTypes !== undefined) {
    rule.applicableEntityTypes = await resolveMasterDataIds('entity_type', body.applicableEntityTypes, 'Entity type');
  }
  if (body.applicableLocationTypes !== undefined) {
    rule.applicableLocationTypes = await resolveMasterDataIds('location_type', body.applicableLocationTypes, 'Location type');
  }
  if (body.applicableStates !== undefined) {
    rule.applicableStates = await resolveStates(body.applicableStates);
  }
  // Keep the legacy copy in step, otherwise clearing a list would be undone on save
  if (rule.applicability) {
    if (body.applicableEntityTypes !== undefined) rule.applicability.entityTypes = rule.applicableEntityTypes;
    if (body.applicableLocationTypes !== undefined) rule.applicability.locationTypes = rule.applicableLocationTypes;
    if (body.applicableStates !== undefined) rule.applicability.states = rule.applicableStates;
  }

  if (body.requiredDocuments !== undefined) {
    rule.requiredDocuments = await resolveRequiredDocuments(body.requiredDocuments);
  }
  if (body.notificationRules !== undefined) rule.notificationRules = resolveNotificationRules(body.notificationRules);
  if (body.escalationRules !== undefined) rule.escalationRules = resolveEscalationRules(body.escalationRules);
  if (body.requiresApproval !== undefined) rule.requiresApproval = Boolean(body.requiresApproval);
  if (body.approvalLevels !== undefined) rule.approvalLevels = Number(body.approvalLevels) || 1;

  rule.updatedBy = actorId(req);
  await rule.save();

  await logRuleAudit(req, 'UPDATE', rule, `Updated compliance rule "${rule.name}" (${rule.code})`, {
    previousValue,
    newValue: auditSnapshot(rule),
  });

  const updated = await populateRule(rule._id);
  return ApiResponse.success(res, { rule: updated }, 'Compliance rule updated successfully');
});

// ── 5. Toggle Rule Active Status ──────────────────────────────────────────────
export const toggleRuleStatus = asyncHandler(async (req: Request, res: Response) => {
  const rule = await findRuleOrFail(String(req.params.id));

  if (rule.status === 'archived') {
    throw ApiError.badRequest(`Rule "${rule.name}" is archived. Restore it before activating it.`);
  }

  const previousStatus = rule.status;
  rule.status = previousStatus === 'active' ? 'inactive' : 'active';
  rule.updatedBy = actorId(req);
  await rule.save();

  await logRuleAudit(
    req,
    'UPDATE',
    rule,
    `${rule.status === 'active' ? 'Activated' : 'Deactivated'} compliance rule "${rule.name}" (${rule.code})`,
    { previousValue: { status: previousStatus }, newValue: { status: rule.status } }
  );

  const updated = await populateRule(rule._id);
  return ApiResponse.success(
    res,
    { rule: updated },
    `Compliance rule ${rule.status === 'active' ? 'activated' : 'deactivated'} successfully`
  );
});

// ── 6. Delete Compliance Rule ─────────────────────────────────────────────────
export const deleteComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await findRuleOrFail(String(req.params.id));

  const recordsCount = await ComplianceRecord.countDocuments({
    $or: [{ rule: rule._id }, { complianceRule: rule._id }],
  });
  if (recordsCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete compliance rule "${rule.name}" because ${recordsCount} compliance record(s) use it. Archive the rule instead.`
    );
  }

  const previousValue = auditSnapshot(rule);
  await rule.deleteOne();

  await logRuleAudit(req, 'DELETE', rule, `Deleted compliance rule "${rule.name}" (${rule.code})`, { previousValue });

  return ApiResponse.success(res, null, `Compliance rule "${rule.name}" deleted successfully`);
});

// ── 7. Evaluate Rule Applicability (Rule Engine Endpoint) ─────────────────────
export const evaluateRuleApplicability = asyncHandler(async (req: Request, res: Response) => {
  const { ruleId, entityId, locationId } = req.body;

  for (const [label, value] of [
    ['rule', ruleId],
    ['entity', entityId],
    ['location', locationId],
  ]) {
    if (value && !mongoose.Types.ObjectId.isValid(value)) throw ApiError.badRequest(`Invalid ${label} ID format`);
  }
  if (!entityId && !locationId) {
    throw ApiError.badRequest('Must provide at least entityId or locationId for evaluation');
  }

  // Users may only test against entities and locations they can see
  if (locationId) {
    const location = await Location.findById(locationId).select('entity');
    if (!location) throw ApiError.notFound('Location not found.');
    assertInScope(req, { entity: location.entity as any, location: location._id });
  } else {
    const entity = await Entity.findById(entityId).select('_id');
    if (!entity) throw ApiError.notFound('Entity not found.');
    assertInScope(req, { entity: entity._id });
  }

  const result = ruleId
    ? await RuleEngineService.evaluateSingleRule(ruleId, { entityId, locationId })
    : await RuleEngineService.getApplicableRules({ entityId, locationId });

  return ApiResponse.success(res, result);
});

// ── 8. Archive / Restore Compliance Rule ──────────────────────────────────────
export const archiveComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await findRuleOrFail(String(req.params.id));

  if (rule.status === 'archived') {
    throw ApiError.badRequest(`Rule "${rule.name}" is already archived`);
  }

  const previousStatus = rule.status;
  rule.status = 'archived';
  rule.updatedBy = actorId(req);
  await rule.save();

  await logRuleAudit(req, 'UPDATE', rule, `Archived compliance rule "${rule.name}" (${rule.code})`, {
    previousValue: { status: previousStatus },
    newValue: { status: 'archived' },
  });

  const updated = await populateRule(rule._id);
  return ApiResponse.success(res, { rule: updated }, `Compliance rule "${rule.name}" has been archived`);
});

/** Brings an archived rule back as inactive, so it only takes effect once someone activates it */
export const restoreComplianceRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await findRuleOrFail(String(req.params.id));

  if (rule.status !== 'archived') {
    throw ApiError.badRequest(`Rule "${rule.name}" is not archived`);
  }

  rule.status = 'inactive';
  rule.updatedBy = actorId(req);
  await rule.save();

  await logRuleAudit(req, 'UPDATE', rule, `Restored compliance rule "${rule.name}" (${rule.code}) from the archive`, {
    previousValue: { status: 'archived' },
    newValue: { status: 'inactive' },
  });

  const updated = await populateRule(rule._id);
  return ApiResponse.success(res, { rule: updated }, `Compliance rule "${rule.name}" restored as inactive`);
});
