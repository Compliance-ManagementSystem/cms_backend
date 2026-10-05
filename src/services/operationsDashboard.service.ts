/**
 * Operations Dashboard
 *
 * One read-only summary of the Location Master data: how many units there are,
 * where they are, and where each unit's licences stand. Everything is computed
 * from Locations and Compliance Records at request time, within the caller's scope.
 *
 * Definitions used throughout:
 *   - Open          : active unit that is not waiting to open
 *   - To be opened  : active unit marked "TBO", or with an opening date in the future
 *   - Closed        : inactive or archived unit
 *   - Licence figures cover units that are not closed, and leave out
 *     records marked "not applicable".
 */

import { Types } from 'mongoose';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import ComplianceRule from '../models/ComplianceRule.js';
import AuditLog from '../models/AuditLog.js';
import { AccessScope, toLocationScopeFilter, toScopeFilter } from '../utils/accessScope.js';

export interface OperationsFilters {
  state?: string;
  entity?: string;
}

export type LicenceBucket = 'approved' | 'applied' | 'toBeApplied' | 'expired';
export type UnitBucket = 'open' | 'toBeOpened' | 'closed';

export type LicenceCounts = Record<LicenceBucket, number> & {
  /** Applicable licences: the four buckets added together */
  total: number;
  /** Share of applicable licences that are approved; null when there are none */
  approvedPct: number | null;
};

export type UnitCounts = Record<UnitBucket, number> & { total: number };

export interface OperationsDashboardData {
  generatedAt: Date;
  filterOptions: {
    states: string[];
    entities: Array<{ _id: string; name: string; code: string }>;
  };
  units: UnitCounts & {
    /** Open units with at least one licence still applied for or to be applied */
    underProcess: number;
    /** Open units whose applicable licences are all approved */
    fullyApproved: number;
  };
  licences: LicenceCounts & { notApplicable: number };
  byState: Array<{ state: string; units: UnitCounts; licences: LicenceCounts }>;
  byLicence: Array<{ ruleId: string; code: string; name: string } & LicenceCounts>;
  topDistricts: Array<{ district: string; state: string; units: number }>;
  unitTypes: Array<{ code: string; label: string; units: number }>;
  areaTypes: Array<{ areaType: string; units: number }>;
  /** Units opened per month, with the running total */
  openingsTrend: Array<{ month: string; opened: number; total: number }>;
  expiring: {
    /** Approved licences that have an expiry date entered */
    withExpiryDate: number;
    next30: number;
    next60: number;
    next90: number;
    items: Array<{
      recordId: string;
      licence: string;
      unit: string;
      state: string;
      expiryDate: Date;
    }>;
  };
  /** Open units with the most licences still to settle */
  attention: Array<{
    locationId: string;
    name: string;
    code: string;
    state: string;
    open: number;
    total: number;
  }>;
  /** Latest audit entries; empty for roles that cannot read the audit trail */
  recentActivity: Array<{
    id: string;
    at: Date;
    action: string;
    description: string;
    by: string;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AREA_TYPE_LABELS: Record<string, string> = { GP: 'Gram Panchayat', NAC: 'NAC', MUN: 'Municipality' };

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const emptyLicences = (): Record<LicenceBucket, number> => ({ approved: 0, applied: 0, toBeApplied: 0, expired: 0 });
const emptyUnits = (): UnitCounts => ({ open: 0, toBeOpened: 0, closed: 0, total: 0 });

const withTotals = (counts: Record<LicenceBucket, number>): LicenceCounts => {
  const total = counts.approved + counts.applied + counts.toBeApplied + counts.expired;
  return { ...counts, total, approvedPct: total > 0 ? Math.round((counts.approved / total) * 100) : null };
};

/** Where a licence stands, worked out by the database for each record */
const licenceBucketExpression = (now: Date) => ({
  $switch: {
    branches: [
      { case: { $eq: ['$status', 'not_applicable'] }, then: 'notApplicable' },
      { case: { $eq: ['$status', 'expired'] }, then: 'expired' },
      {
        case: { $in: ['$status', ['approved', 'expiring_soon']] },
        // Approved but past its expiry date counts as expired
        then: { $cond: [{ $and: [{ $eq: [{ $type: '$expiryDate' }, 'date'] }, { $lt: ['$expiryDate', now] }] }, 'expired', 'approved'] },
      },
      { case: { $in: ['$status', ['in_progress', 'submitted', 'resubmitted', 'under_review']] }, then: 'applied' },
    ],
    default: 'toBeApplied',
  },
});

const unitBucket = (
  location: { status: string; isUpcoming?: boolean; openingDate?: Date | null },
  now: Date
): UnitBucket => {
  if (location.status !== 'active') return 'closed';
  const opening = location.openingDate ? new Date(location.openingDate) : null;
  if (opening && opening > now) return 'toBeOpened';
  if (location.isUpcoming && !opening) return 'toBeOpened';
  return 'open';
};

export class OperationsDashboardService {
  public static async getOverview(
    filters: OperationsFilters = {},
    scope: AccessScope = { unrestricted: true },
    canReadAuditTrail = false
  ): Promise<OperationsDashboardData> {
    const now = new Date();

    // ── Units in scope, narrowed by the page filters ───────────────────────────
    const scopedLocationFilter = toLocationScopeFilter(scope);
    const locationConditions: Record<string, any>[] = [scopedLocationFilter];
    if (filters.state) {
      locationConditions.push({ 'address.state': new RegExp(`^${escapeRegex(filters.state.trim())}$`, 'i') });
    }
    if (filters.entity) {
      const entityId = new Types.ObjectId(filters.entity);
      locationConditions.push({ $or: [{ entity: entityId }, { 'coEntities.entity': entityId }] });
    }

    const [locations, scopedStates, entities] = await Promise.all([
      Location.find({ $and: locationConditions })
        .select('name code status isUpcoming openingDate areaType locationType address.state address.district')
        .populate('locationType', 'code label')
        .lean(),
      Location.find(scopedLocationFilter).distinct('address.state'),
      Entity.find(
        scope.unrestricted || !scope.entityId
          ? { status: 'active' }
          : { status: 'active', _id: new Types.ObjectId(scope.entityId) }
      )
        .select('name code')
        .sort({ name: 1 })
        .lean(),
    ]);

    const locationById = new Map(locations.map((loc) => [String(loc._id), loc]));
    const bucketByLocation = new Map(locations.map((loc) => [String(loc._id), unitBucket(loc, now)]));

    // ── Unit counts ────────────────────────────────────────────────────────────
    const units = emptyUnits();
    const stateUnits = new Map<string, UnitCounts>();
    const districtUnits = new Map<string, { district: string; state: string; units: number }>();
    const typeUnits = new Map<string, { code: string; label: string; units: number }>();
    const areaUnits = new Map<string, number>();
    const openedByMonth = new Map<string, number>();

    for (const loc of locations) {
      const bucket = bucketByLocation.get(String(loc._id))!;
      const state = loc.address?.state?.trim() || 'Unknown';
      units[bucket]++;
      units.total++;

      if (!stateUnits.has(state)) stateUnits.set(state, emptyUnits());
      stateUnits.get(state)![bucket]++;
      stateUnits.get(state)!.total++;

      // The remaining breakdowns describe the units that are running or planned
      if (bucket === 'closed') continue;

      const district = loc.address?.district?.trim();
      if (district) {
        const key = `${district.toLowerCase()}|${state.toLowerCase()}`;
        if (!districtUnits.has(key)) districtUnits.set(key, { district, state, units: 0 });
        districtUnits.get(key)!.units++;
      }

      const type = loc.locationType as { code?: string; label?: string } | undefined;
      const typeCode = type?.code || 'UNKNOWN';
      if (!typeUnits.has(typeCode)) typeUnits.set(typeCode, { code: typeCode, label: type?.label || 'Unknown', units: 0 });
      typeUnits.get(typeCode)!.units++;

      const areaType = loc.areaType || 'Not set';
      areaUnits.set(areaType, (areaUnits.get(areaType) || 0) + 1);
    }

    // Opening trend counts every unit that has an opening date, closed ones included
    for (const loc of locations) {
      if (!loc.openingDate) continue;
      const opened = new Date(loc.openingDate);
      if (opened > now) continue;
      const key = `${opened.getFullYear()}-${String(opened.getMonth() + 1).padStart(2, '0')}`;
      openedByMonth.set(key, (openedByMonth.get(key) || 0) + 1);
    }
    const openingsTrend: OperationsDashboardData['openingsTrend'] = [];
    const monthKeys = Array.from(openedByMonth.keys()).sort();
    if (monthKeys.length > 0) {
      const [startYear, startMonth] = monthKeys[0].split('-').map(Number);
      let running = 0;
      for (let d = new Date(startYear, startMonth - 1, 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const opened = openedByMonth.get(key) || 0;
        running += opened;
        openingsTrend.push({
          month: `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
          opened,
          total: running,
        });
      }
    }

    // ── Licence counts ─────────────────────────────────────────────────────────
    // Counted inside the database: only the totals travel back, never the records.
    const liveLocationIds = locations
      .filter((loc) => bucketByLocation.get(String(loc._id)) !== 'closed')
      .map((loc) => loc._id);
    const recordConditions: Record<string, any>[] = [toScopeFilter(scope), { location: { $in: liveLocationIds } }];
    if (filters.entity) recordConditions.push({ entity: new Types.ObjectId(filters.entity) });

    const in90Days = new Date(now.getTime() + 90 * DAY_MS);
    const withinDays = (days: number) => ({
      $sum: { $cond: [{ $lte: ['$expiryDate', new Date(now.getTime() + days * DAY_MS)] }, 1, 0] },
    });

    const [[summary], rules] = await Promise.all([
      ComplianceRecord.aggregate<{
        byLocation: Array<{ _id: { location: Types.ObjectId; bucket: LicenceBucket | 'notApplicable' }; count: number }>;
        byRule: Array<{ _id: { rule: Types.ObjectId; bucket: LicenceBucket | 'notApplicable' }; count: number }>;
        expiryTotals: Array<{ withExpiryDate: number; next30: number; next60: number; next90: number }>;
        expiryItems: Array<{ _id: Types.ObjectId; location: Types.ObjectId; rule: Types.ObjectId; expiryDate: Date }>;
      }>([
        { $match: { $and: recordConditions } },
        { $project: { location: 1, rule: 1, expiryDate: 1, bucket: licenceBucketExpression(now) } },
        {
          $facet: {
            byLocation: [{ $group: { _id: { location: '$location', bucket: '$bucket' }, count: { $sum: 1 } } }],
            byRule: [{ $group: { _id: { rule: '$rule', bucket: '$bucket' }, count: { $sum: 1 } } }],
            expiryTotals: [
              { $match: { bucket: 'approved', expiryDate: { $type: 'date' } } },
              {
                $group: {
                  _id: null,
                  withExpiryDate: { $sum: 1 },
                  next30: withinDays(30),
                  next60: withinDays(60),
                  next90: withinDays(90),
                },
              },
            ],
            expiryItems: [
              { $match: { bucket: 'approved', expiryDate: { $type: 'date', $lte: in90Days } } },
              { $sort: { expiryDate: 1 } },
              { $limit: 8 },
              { $project: { location: 1, rule: 1, expiryDate: 1 } },
            ],
          },
        },
      ]),
      ComplianceRule.find().select('name code').lean(),
    ]);
    const ruleById = new Map(rules.map((rule) => [String(rule._id), rule]));

    const totals = emptyLicences();
    let notApplicable = 0;
    const stateLicences = new Map<string, Record<LicenceBucket, number>>();
    const ruleLicences = new Map<string, Record<LicenceBucket, number>>();
    const unitLicences = new Map<string, Record<LicenceBucket, number>>();

    for (const row of summary?.byLocation || []) {
      const locationId = String(row._id.location);
      const location = locationById.get(locationId);
      if (!location) continue;
      if (row._id.bucket === 'notApplicable') {
        notApplicable += row.count;
        continue;
      }
      const state = location.address?.state?.trim() || 'Unknown';
      totals[row._id.bucket] += row.count;
      if (!stateLicences.has(state)) stateLicences.set(state, emptyLicences());
      stateLicences.get(state)![row._id.bucket] += row.count;
      if (!unitLicences.has(locationId)) unitLicences.set(locationId, emptyLicences());
      unitLicences.get(locationId)![row._id.bucket] += row.count;
    }
    for (const row of summary?.byRule || []) {
      if (row._id.bucket === 'notApplicable') continue;
      const ruleId = String(row._id.rule);
      if (!ruleLicences.has(ruleId)) ruleLicences.set(ruleId, emptyLicences());
      ruleLicences.get(ruleId)![row._id.bucket] += row.count;
    }

    const expiryTotals = summary?.expiryTotals[0];
    const expiring: OperationsDashboardData['expiring'] = {
      withExpiryDate: expiryTotals?.withExpiryDate || 0,
      next30: expiryTotals?.next30 || 0,
      next60: expiryTotals?.next60 || 0,
      next90: expiryTotals?.next90 || 0,
      items: (summary?.expiryItems || []).map((item) => {
        const location = locationById.get(String(item.location));
        return {
          recordId: String(item._id),
          licence: ruleById.get(String(item.rule))?.name || 'Licence',
          unit: location?.name || 'Unit',
          state: location?.address?.state?.trim() || 'Unknown',
          expiryDate: item.expiryDate,
        };
      }),
    };

    // ── Per-unit roll-ups ──────────────────────────────────────────────────────
    let underProcess = 0;
    let fullyApproved = 0;
    const attention: OperationsDashboardData['attention'] = [];
    for (const [locationId, counts] of unitLicences) {
      if (bucketByLocation.get(locationId) !== 'open') continue;
      const location = locationById.get(locationId)!;
      const summary = withTotals(counts);
      if (counts.applied + counts.toBeApplied > 0) underProcess++;
      if (summary.total > 0 && counts.approved === summary.total) fullyApproved++;

      const open = counts.applied + counts.toBeApplied + counts.expired;
      if (open > 0) {
        attention.push({
          locationId,
          name: location.name,
          code: location.code,
          state: location.address?.state?.trim() || 'Unknown',
          open,
          total: summary.total,
        });
      }
    }
    attention.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

    // ── Recent activity ────────────────────────────────────────────────────────
    let recentActivity: OperationsDashboardData['recentActivity'] = [];
    if (canReadAuditTrail) {
      // Sign-ins and sign-outs are not changes to the data
      const auditFilter: Record<string, any> = { action: { $not: /LOGIN|LOGOUT/i } };
      if (!scope.unrestricted && scope.entityId) {
        auditFilter.entityId = { $in: [scope.entityId, new Types.ObjectId(scope.entityId)] };
      }
      const logs = await AuditLog.find(auditFilter)
        .sort({ createdAt: -1 })
        .limit(6)
        .select('action description actorEmail user createdAt')
        .populate('user', 'firstName lastName')
        .lean();
      recentActivity = logs.map((log) => {
        const user = log.user as { firstName?: string; lastName?: string } | undefined;
        return {
          id: String(log._id),
          at: log.createdAt,
          action: log.action,
          description: log.description,
          by: user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : log.actorEmail || 'System',
        };
      });
    }

    const states = Array.from(new Set([...stateUnits.keys(), ...stateLicences.keys()]));

    return {
      generatedAt: now,
      filterOptions: {
        states: (scopedStates as string[]).filter(Boolean).map((state) => state.trim()).sort(),
        entities: entities.map((entity) => ({ _id: String(entity._id), name: entity.name, code: entity.code })),
      },
      units: { ...units, underProcess, fullyApproved },
      licences: { ...withTotals(totals), notApplicable },
      byState: states
        .map((state) => ({
          state,
          units: stateUnits.get(state) || emptyUnits(),
          licences: withTotals(stateLicences.get(state) || emptyLicences()),
        }))
        .sort((a, b) => b.units.total - a.units.total || a.state.localeCompare(b.state)),
      byLicence: Array.from(ruleLicences.entries())
        .map(([ruleId, counts]) => ({
          ruleId,
          code: ruleById.get(ruleId)?.code || '',
          name: ruleById.get(ruleId)?.name || 'Licence',
          ...withTotals(counts),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      topDistricts: Array.from(districtUnits.values())
        .sort((a, b) => b.units - a.units || a.district.localeCompare(b.district))
        .slice(0, 10),
      unitTypes: Array.from(typeUnits.values()).sort((a, b) => b.units - a.units),
      areaTypes: Array.from(areaUnits.entries())
        .map(([areaType, count]) => ({ areaType: AREA_TYPE_LABELS[areaType] || areaType, units: count }))
        .sort((a, b) => b.units - a.units),
      openingsTrend,
      expiring,
      attention: attention.slice(0, 8),
      recentActivity,
    };
  }
}

export const operationsDashboardService = OperationsDashboardService;
