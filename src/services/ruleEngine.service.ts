/**
 * Reusable Compliance Rule Evaluation Service
 *
 * Encapsulates the core rule engine logic to determine whether a ComplianceRule
 * applies to a given Entity and/or Location based on:
 *   1. Entity Type
 *   2. Location Type
 *   3. Jurisdiction / State
 *   4. Active Operational Status
 */

import mongoose from 'mongoose';
import ComplianceRule, { IComplianceRule } from '../models/ComplianceRule.js';
import Entity, { IEntity } from '../models/Entity.js';
import Location, { ILocation } from '../models/Location.js';

export interface EvaluationResult {
  isApplicable: boolean;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  category?: string;
  mandatory: boolean;
  reasons: string[];
  matches: {
    statusMatch: boolean;
    entityTypeMatch: boolean;
    locationTypeMatch: boolean;
    stateMatch: boolean;
  };
}

export class RuleEngineService {
  /**
   * Evaluate if a specific ComplianceRule is applicable to an Entity and/or Location in-memory.
   */
  public static isRuleApplicable(
    rule: IComplianceRule | any,
    target: {
      entity?: Partial<IEntity> | any;
      location?: Partial<ILocation> | any;
    }
  ): EvaluationResult {
    const reasons: string[] = [];
    const matches = {
      statusMatch: true,
      entityTypeMatch: true,
      locationTypeMatch: true,
      stateMatch: true,
    };

    // 1. Rule Active Check
    if (rule.status !== 'active' && rule.active === false) {
      matches.statusMatch = false;
      reasons.push('Rule is currently inactive or archived.');
    }

    // Resolve target context
    let entityDoc = target.entity;
    if (!entityDoc || !entityDoc.entityType) {
      if (
        target.location?.entity &&
        typeof target.location.entity === 'object' &&
        'entityType' in target.location.entity
      ) {
        entityDoc = target.location.entity;
      }
    }
    const locationDoc = target.location;

    // 2. Entity Type Applicability Filter
    // Empty list = ALL Entity Types
    const applicableEntityTypes: string[] = (
      rule.applicableEntityTypes?.length ? rule.applicableEntityTypes : rule.applicability?.entityTypes || []
    ).map((t: any) => (t?._id ? t._id.toString() : t.toString()));

    if (applicableEntityTypes.length > 0) {
      if (!entityDoc) {
        matches.entityTypeMatch = false;
        reasons.push('Rule requires specific Entity Types, but no Entity context was provided.');
      } else {
        const targetEntityTypeId = entityDoc.entityType?._id
          ? entityDoc.entityType._id.toString()
          : entityDoc.entityType?.toString();

        const targetEntityTypeCode = entityDoc.entityType?.code
          ? entityDoc.entityType.code.toUpperCase()
          : '';

        const hasMatch = applicableEntityTypes.some(
          (tId) => tId === targetEntityTypeId || tId.toUpperCase() === targetEntityTypeCode
        );

        if (!hasMatch) {
          matches.entityTypeMatch = false;
          reasons.push(
            `Entity type "${targetEntityTypeCode || targetEntityTypeId}" does not match rule's applicable entity types.`
          );
        }
      }
    }

    // 3. Location Type Applicability Filter
    // Empty list = ALL Location Types (or Entity-wide)
    const applicableLocationTypes: string[] = (
      rule.applicableLocationTypes?.length
        ? rule.applicableLocationTypes
        : rule.applicability?.locationTypes || []
    ).map((t: any) => (t?._id ? t._id.toString() : t.toString()));

    if (applicableLocationTypes.length > 0) {
      if (!locationDoc) {
        matches.locationTypeMatch = false;
        reasons.push('Rule requires specific Location Types, but evaluated target has no Location context.');
      } else {
        const targetLocTypeId = locationDoc.locationType?._id
          ? locationDoc.locationType._id.toString()
          : locationDoc.locationType?.toString();

        const targetLocTypeCode = locationDoc.locationType?.code
          ? locationDoc.locationType.code.toUpperCase()
          : '';

        const hasMatch = applicableLocationTypes.some(
          (tId) => tId === targetLocTypeId || tId.toUpperCase() === targetLocTypeCode
        );

        if (!hasMatch) {
          matches.locationTypeMatch = false;
          reasons.push(
            `Location type "${targetLocTypeCode || targetLocTypeId}" does not match rule's applicable location types.`
          );
        }
      }
    }

    // 4. State / Geographical Jurisdiction Filter
    // Empty list = ALL States (Pan-India)
    const applicableStates: string[] = (
      rule.applicableStates?.length ? rule.applicableStates : rule.applicability?.states || []
    ).map((s: string) => s.trim().toUpperCase());

    if (applicableStates.length > 0 && !applicableStates.includes('ALL')) {
      const targetState = (
        locationDoc?.address?.state ||
        entityDoc?.address?.state ||
        ''
      ).trim().toUpperCase();

      if (!targetState) {
        matches.stateMatch = false;
        reasons.push('Rule requires specific State jurisdiction, but target has no State defined in address.');
      } else {
        const stateMatches = applicableStates.some(
          (s) => s === targetState || targetState.includes(s) || s.includes(targetState)
        );

        if (!stateMatches) {
          matches.stateMatch = false;
          reasons.push(
            `Target state "${targetState}" is outside rule jurisdiction (${applicableStates.join(', ')}).`
          );
        }
      }
    }

    const isApplicable =
      matches.statusMatch &&
      matches.entityTypeMatch &&
      matches.locationTypeMatch &&
      matches.stateMatch;

    if (isApplicable) {
      reasons.push('Rule is fully applicable based on Entity Type, Location Type, and State criteria.');
    }

    return {
      isApplicable,
      ruleId: rule._id ? rule._id.toString() : '',
      ruleCode: rule.code,
      ruleName: rule.name,
      category: rule.category?.label || rule.category?.code || (rule.category as any),
      mandatory: rule.mandatory ?? true,
      reasons,
      matches,
    };
  }

  /**
   * Find all active compliance rules applicable to a specific Entity and/or Location.
   */
  public static async getApplicableRules(context: {
    entityId?: string;
    locationId?: string;
  }): Promise<{
    target: { entity?: any; location?: any };
    applicableRules: EvaluationResult[];
    inapplicableRules: EvaluationResult[];
  }> {
    let entityDoc: any = null;
    let locationDoc: any = null;

    if (context.locationId && mongoose.Types.ObjectId.isValid(context.locationId)) {
      locationDoc = await Location.findById(context.locationId)
        .populate('entity')
        .populate('locationType')
        .lean();
      if (locationDoc?.entity) {
        entityDoc = locationDoc.entity;
      }
    }

    if (!entityDoc && context.entityId && mongoose.Types.ObjectId.isValid(context.entityId)) {
      entityDoc = await Entity.findById(context.entityId)
        .populate('entityType')
        .lean();
    }

    // Load all active compliance rules with populated master data
    const allRules = await ComplianceRule.find({ status: 'active' })
      .populate('category', 'code label')
      .populate('frequency', 'code label')
      .populate('applicableEntityTypes', 'code label')
      .populate('applicableLocationTypes', 'code label')
      .populate('requiredDocuments.documentType', 'code label')
      .lean();

    const applicableRules: EvaluationResult[] = [];
    const inapplicableRules: EvaluationResult[] = [];

    for (const rule of allRules) {
      const evaluation = this.isRuleApplicable(rule, {
        entity: entityDoc,
        location: locationDoc,
      });

      if (evaluation.isApplicable) {
        applicableRules.push(evaluation);
      } else {
        inapplicableRules.push(evaluation);
      }
    }

    return {
      target: {
        entity: entityDoc ? { _id: entityDoc._id, name: entityDoc.name, code: entityDoc.code } : null,
        location: locationDoc ? { _id: locationDoc._id, name: locationDoc.name, code: locationDoc.code } : null,
      },
      applicableRules,
      inapplicableRules,
    };
  }

  /**
   * Evaluate a single rule against a given Entity or Location by IDs.
   */
  public static async evaluateSingleRule(
    ruleId: string,
    context: { entityId?: string; locationId?: string }
  ): Promise<{
    rule: any;
    target: any;
    evaluation: EvaluationResult;
  }> {
    const rule = await ComplianceRule.findById(ruleId)
      .populate('category', 'code label')
      .populate('frequency', 'code label')
      .populate('applicableEntityTypes', 'code label')
      .populate('applicableLocationTypes', 'code label')
      .populate('requiredDocuments.documentType', 'code label')
      .lean();

    if (!rule) {
      throw new Error(`Compliance Rule with ID "${ruleId}" not found`);
    }

    let entityDoc: any = null;
    let locationDoc: any = null;

    if (context.locationId && mongoose.Types.ObjectId.isValid(context.locationId)) {
      locationDoc = await Location.findById(context.locationId)
        .populate('entity')
        .populate('locationType')
        .lean();
      if (locationDoc?.entity) {
        entityDoc = locationDoc.entity;
      }
    }

    if (!entityDoc && context.entityId && mongoose.Types.ObjectId.isValid(context.entityId)) {
      entityDoc = await Entity.findById(context.entityId)
        .populate('entityType')
        .lean();
    }

    const evaluation = this.isRuleApplicable(rule, {
      entity: entityDoc,
      location: locationDoc,
    });

    return {
      rule,
      target: {
        entity: entityDoc
          ? {
              _id: entityDoc._id,
              name: entityDoc.name,
              code: entityDoc.code,
              type: entityDoc.entityType?.code || entityDoc.entityType?.label,
              state: entityDoc.address?.state,
            }
          : null,
        location: locationDoc
          ? {
              _id: locationDoc._id,
              name: locationDoc.name,
              code: locationDoc.code,
              type: locationDoc.locationType?.code || locationDoc.locationType?.label,
              state: locationDoc.address?.state,
            }
          : null,
      },
      evaluation,
    };
  }
}

export default RuleEngineService;
