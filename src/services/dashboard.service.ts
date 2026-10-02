import { Types } from 'mongoose';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import ComplianceRule from '../models/ComplianceRule.js';
import Task, { ACTIVE_TASK_STATUSES, overdueTaskFilter } from '../models/Task.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import { AccessScope, toScopeFilter } from '../utils/accessScope.js';

export interface DashboardFilters {
  state?: string;
  entity?: string;
  location?: string;
  category?: string;
}

export type DashboardLevel = 'national' | 'state' | 'entity' | 'location';
export type DashboardRating = 'green' | 'yellow' | 'orange' | 'red';

/**
 * Every compliance record falls into exactly one health bucket:
 *   - compliant    : approved and valid beyond the expiring-soon window
 *   - expiringSoon : approved and valid, but expires within EXPIRING_SOON_DAYS
 *   - pending      : somewhere in the workflow (not yet approved, rejected, in correction)
 *   - expired      : validity has lapsed
 */
export type HealthBucket = 'compliant' | 'expiringSoon' | 'pending' | 'expired';

export const EXPIRING_SOON_DAYS = 30;

export interface HealthCounts {
  total: number;
  compliant: number;
  expiringSoon: number;
  pending: number;
  expired: number;
  /** Share of records that are currently valid (compliant + expiring soon) */
  percentage: number;
}

export interface DashboardKPIs extends Omit<HealthCounts, 'percentage'> {
  /** null when there are no records to score */
  compliancePercentage: number | null;
  openTasks: number;
  overdueTasks: number;
}

export interface StatusDistributionItem {
  bucket: HealthBucket;
  name: string;
  value: number;
  color: string;
}

export interface StateComplianceItem extends HealthCounts {
  state: string;
}

export interface EntityComplianceItem extends HealthCounts {
  entityId: string;
  name: string;
  code: string;
}

export interface LocationComplianceItem extends HealthCounts {
  locationId: string;
  name: string;
  code: string;
  entityName: string;
  state: string;
}

export interface CategoryComplianceItem extends HealthCounts {
  categoryId: string;
  name: string;
}

export interface UpcomingExpiryItem {
  month: string;
  expiring: number;
}

export interface TaskWorkloadItem {
  userId: string;
  name: string;
  /** Active tasks still within their due date */
  onTime: number;
  overdue: number;
}

export interface OverdueAgeingItem {
  bucket: string;
  tasks: number;
}

export interface DashboardAlert {
  id: string;
  type: 'expired_compliance' | 'overdue_task' | 'critical_task';
  title: string;
  entityName: string;
  locationName: string;
  severity: 'critical' | 'high';
  date: Date;
  recordId?: string;
  taskId?: string;
}

export interface DashboardData {
  level: DashboardLevel;
  selectedState?: string;
  selectedEntity?: { _id: string; name: string; code: string };
  selectedLocation?: { _id: string; name: string; code: string };
  kpis: DashboardKPIs;
  /** null when there are no records in the current selection */
  overallRating: DashboardRating | null;
  charts: {
    statusDistribution: StatusDistributionItem[];
    stateWiseCompliance: StateComplianceItem[];
    entityWiseCompliance: EntityComplianceItem[];
    locationWiseCompliance: LocationComplianceItem[];
    categoryWiseCompliance: CategoryComplianceItem[];
    upcomingExpiries: UpcomingExpiryItem[];
    taskWorkload: TaskWorkloadItem[];
    overdueAgeing: OverdueAgeingItem[];
  };
  alerts: DashboardAlert[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const classifyRecord = (
  record: { status: string; expiryDate?: Date | null },
  now: Date
): HealthBucket => {
  if (record.status === 'expired') return 'expired';

  if (record.status === 'approved' || record.status === 'expiring_soon') {
    const expiry = record.expiryDate ? new Date(record.expiryDate) : null;
    if (expiry && expiry < now) return 'expired'; // lapsed, nightly job has not flipped it yet
    if (expiry && expiry.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) return 'expiringSoon';
    return 'compliant';
  }

  return 'pending';
};

const emptyCounts = (): Omit<HealthCounts, 'percentage'> => ({
  total: 0,
  compliant: 0,
  expiringSoon: 0,
  pending: 0,
  expired: 0,
});

const withPercentage = (counts: Omit<HealthCounts, 'percentage'>): HealthCounts => ({
  ...counts,
  percentage:
    counts.total > 0 ? Math.round(((counts.compliant + counts.expiringSoon) / counts.total) * 100) : 0,
});

/** Entities and locations the caller is allowed to see */
const entityScopeFilter = (scope: AccessScope): Record<string, any> =>
  scope.unrestricted || !scope.entityId ? {} : { _id: new Types.ObjectId(scope.entityId) };

const locationScopeFilter = (scope: AccessScope): Record<string, any> => {
  if (scope.unrestricted) return {};
  const filter: Record<string, any> = {};
  if (scope.entityId) filter.entity = new Types.ObjectId(scope.entityId);
  if (scope.locationIds) filter._id = { $in: scope.locationIds.map((id) => new Types.ObjectId(id)) };
  return filter;
};

export class DashboardService {
  /**
   * Aggregates compliance health, task load and alerts for the current selection,
   * limited to what the caller's scope allows.
   */
  public static async getDashboardStats(
    filters: DashboardFilters = {},
    scope: AccessScope = { unrestricted: true }
  ): Promise<DashboardData> {
    const now = new Date();

    const level: DashboardLevel = filters.location
      ? 'location'
      : filters.entity
      ? 'entity'
      : filters.state
      ? 'state'
      : 'national';

    // ── 1. Build record & task filters ────────────────────────────────────────
    const scopeFilter = toScopeFilter(scope);
    const recordConditions: Record<string, any>[] = [scopeFilter, { status: { $ne: 'not_applicable' } }];
    const taskConditions: Record<string, any>[] = [scopeFilter];

    if (filters.state) {
      const stateLocationIds = await Location.find({
        'address.state': new RegExp(`^${escapeRegex(filters.state.trim())}$`, 'i'),
      }).distinct('_id');
      recordConditions.push({ location: { $in: stateLocationIds } });
      taskConditions.push({ location: { $in: stateLocationIds } });
    }

    if (filters.entity) {
      const entityId = new Types.ObjectId(filters.entity);
      recordConditions.push({ entity: entityId });
      taskConditions.push({ entity: entityId });
    }

    if (filters.location) {
      const locationId = new Types.ObjectId(filters.location);
      recordConditions.push({ location: locationId });
      taskConditions.push({ location: locationId });
    }

    if (filters.category) {
      const ruleIds = await ComplianceRule.find({
        category: new Types.ObjectId(filters.category),
      }).distinct('_id');
      recordConditions.push({ rule: { $in: ruleIds } });
    }

    const taskMatch = { $and: taskConditions };

    // ── 2. Load records and classify each one once ────────────────────────────
    const loadedRecords = await ComplianceRecord.find({ $and: recordConditions })
      .select('status expiryDate entity location rule')
      .populate('entity', 'name code')
      .populate('location', 'name code address.state')
      .populate('rule', 'name category')
      .lean();

    // Records whose entity or location has been deleted cannot be attributed to anything
    const records = loadedRecords.filter((rec) => rec.entity && rec.location);

    const totals = emptyCounts();
    const stateMap = new Map<string, Omit<HealthCounts, 'percentage'>>();
    const entityMap = new Map<string, Omit<EntityComplianceItem, 'percentage'>>();
    const locationMap = new Map<string, Omit<LocationComplianceItem, 'percentage'>>();
    const categoryMap = new Map<string, Omit<HealthCounts, 'percentage'>>();
    const expiredRecords: typeof records = [];

    // Upcoming expiries: this month and the following eleven
    const upcomingExpiries: UpcomingExpiryItem[] = [];
    const monthIndex = new Map<string, number>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      monthIndex.set(`${d.getFullYear()}-${d.getMonth()}`, i);
      upcomingExpiries.push({
        month: `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
        expiring: 0,
      });
    }

    for (const rec of records) {
      const bucket = classifyRecord(rec, now);
      const entity = rec.entity as any;
      const location = rec.location as any;
      const stateName = location.address?.state || 'No state set';

      const bump = (counts: Omit<HealthCounts, 'percentage'>) => {
        counts.total++;
        counts[bucket]++;
      };

      bump(totals);

      if (!stateMap.has(stateName)) stateMap.set(stateName, emptyCounts());
      bump(stateMap.get(stateName)!);

      const entityId = entity._id.toString();
      if (!entityMap.has(entityId)) {
        entityMap.set(entityId, { entityId, name: entity.name, code: entity.code, ...emptyCounts() });
      }
      bump(entityMap.get(entityId)!);

      const locationId = location._id.toString();
      if (!locationMap.has(locationId)) {
        locationMap.set(locationId, {
          locationId,
          name: location.name,
          code: location.code,
          entityName: entity.name,
          state: stateName,
          ...emptyCounts(),
        });
      }
      bump(locationMap.get(locationId)!);

      const categoryId = (rec.rule as any)?.category?.toString() || 'none';
      if (!categoryMap.has(categoryId)) categoryMap.set(categoryId, emptyCounts());
      bump(categoryMap.get(categoryId)!);

      if (bucket === 'expired') expiredRecords.push(rec);

      // Valid records count towards the month their validity ends
      if ((bucket === 'compliant' || bucket === 'expiringSoon') && rec.expiryDate) {
        const expiry = new Date(rec.expiryDate);
        const slot = monthIndex.get(`${expiry.getFullYear()}-${expiry.getMonth()}`);
        if (slot !== undefined) upcomingExpiries[slot].expiring++;
      }
    }

    const byTotalDesc = <T extends { total: number }>(a: T, b: T) => b.total - a.total;

    const categoryIds = Array.from(categoryMap.keys()).filter((id) => id !== 'none');
    const categoryDocs = await MasterData.find({ _id: { $in: categoryIds } }).select('label').lean();
    const categoryLabels = new Map(categoryDocs.map((c) => [c._id.toString(), c.label]));

    // ── 3. Task load ──────────────────────────────────────────────────────────
    const [openTasks, overdueTasks, urgentTasks, workloadGroups, overdueDueDates] = await Promise.all([
      Task.countDocuments({ $and: [taskMatch, { status: { $in: ACTIVE_TASK_STATUSES } }] }),
      Task.countDocuments({ $and: [taskMatch, overdueTaskFilter(now)] }),
      Task.find({
        $and: [
          taskMatch,
          { status: { $in: ACTIVE_TASK_STATUSES } },
          { $or: [{ priority: 'critical' }, { dueDate: { $lt: now } }] },
        ],
      })
        .select('title priority dueDate createdAt complianceRecord entity location')
        .populate('entity', 'name')
        .populate('location', 'name')
        .sort({ dueDate: 1 })
        .limit(20)
        .lean(),
      // Active tasks per assignee, busiest first
      Task.aggregate<{ _id: Types.ObjectId; active: number; overdue: number }>([
        { $match: { $and: [taskMatch, { status: { $in: ACTIVE_TASK_STATUSES } }] } },
        {
          $group: {
            _id: '$assignedTo',
            active: { $sum: 1 },
            overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
          },
        },
        { $sort: { active: -1 } },
        { $limit: 8 },
      ]),
      Task.find({ $and: [taskMatch, overdueTaskFilter(now)] }).select('dueDate').lean(),
    ]);

    const assignees = await User.find({ _id: { $in: workloadGroups.map((g) => g._id) } })
      .select('firstName lastName')
      .lean();
    const assigneeNames = new Map(
      assignees.map((u) => [u._id.toString(), `${u.firstName} ${u.lastName}`.trim()])
    );
    const taskWorkload: TaskWorkloadItem[] = workloadGroups.map((g) => ({
      userId: g._id?.toString() || '',
      name: assigneeNames.get(g._id?.toString() || '') || 'Unknown user',
      onTime: g.active - g.overdue,
      overdue: g.overdue,
    }));

    // How long overdue tasks have been waiting
    const overdueAgeing: OverdueAgeingItem[] = [
      { bucket: '1–7 days', tasks: 0 },
      { bucket: '8–30 days', tasks: 0 },
      { bucket: 'Over 30 days', tasks: 0 },
    ];
    for (const task of overdueDueDates) {
      const daysLate = (now.getTime() - new Date(task.dueDate).getTime()) / DAY_MS;
      overdueAgeing[daysLate <= 7 ? 0 : daysLate <= 30 ? 1 : 2].tasks++;
    }

    // ── 4. Overall rating ─────────────────────────────────────────────────────
    let overallRating: DashboardRating | null = null;
    if (totals.total > 0) {
      overallRating =
        totals.expired > 0 || overdueTasks > 0
          ? 'red'
          : totals.pending > 0
          ? 'orange'
          : totals.expiringSoon > 0
          ? 'yellow'
          : 'green';
    }

    // ── 5. Alerts: expired compliance first, then urgent tasks ────────────────
    const alerts: DashboardAlert[] = expiredRecords.map((rec) => ({
      id: `record-${rec._id}`,
      type: 'expired_compliance' as const,
      title: `Expired: ${(rec.rule as any)?.name || 'Compliance obligation'}`,
      entityName: (rec.entity as any).name,
      locationName: (rec.location as any).name,
      severity: 'critical' as const,
      date: rec.expiryDate ? new Date(rec.expiryDate) : now,
      recordId: rec._id.toString(),
    }));

    // A task raised for an already-listed expired record would say the same thing twice
    const alertedRecordIds = new Set(expiredRecords.map((rec) => rec._id.toString()));
    for (const task of urgentTasks) {
      if (task.complianceRecord && alertedRecordIds.has(task.complianceRecord.toString())) continue;
      const isOverdue = !!task.dueDate && new Date(task.dueDate) < now;
      alerts.push({
        id: `task-${task._id}`,
        type: isOverdue ? 'overdue_task' : 'critical_task',
        title: task.title,
        entityName: (task.entity as any)?.name || '—',
        locationName: (task.location as any)?.name || '—',
        severity: task.priority === 'critical' ? 'critical' : 'high',
        date: task.dueDate ? new Date(task.dueDate) : new Date(task.createdAt),
        taskId: task._id.toString(),
      });
    }

    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return a.date.getTime() - b.date.getTime();
    });

    // ── 6. Names for the breadcrumb (only if the caller may see them) ─────────
    const [selectedEntity, selectedLocation] = await Promise.all([
      filters.entity
        ? Entity.findOne({ $and: [{ _id: filters.entity }, entityScopeFilter(scope)] })
            .select('name code')
            .lean()
        : null,
      filters.location
        ? Location.findOne({ $and: [{ _id: filters.location }, locationScopeFilter(scope)] })
            .select('name code')
            .lean()
        : null,
    ]);

    return {
      level,
      selectedState: filters.state,
      selectedEntity: selectedEntity
        ? { _id: selectedEntity._id.toString(), name: selectedEntity.name, code: selectedEntity.code }
        : undefined,
      selectedLocation: selectedLocation
        ? { _id: selectedLocation._id.toString(), name: selectedLocation.name, code: selectedLocation.code }
        : undefined,
      kpis: {
        ...totals,
        compliancePercentage: totals.total > 0 ? withPercentage(totals).percentage : null,
        openTasks,
        overdueTasks,
      },
      overallRating,
      charts: {
        statusDistribution: [
          { bucket: 'compliant', name: 'Compliant', value: totals.compliant, color: '#10b981' },
          { bucket: 'expiringSoon', name: 'Expiring Soon', value: totals.expiringSoon, color: '#f59e0b' },
          { bucket: 'pending', name: 'Pending Action', value: totals.pending, color: '#f97316' },
          { bucket: 'expired', name: 'Expired', value: totals.expired, color: '#ef4444' },
        ],
        stateWiseCompliance: Array.from(stateMap.entries())
          .map(([state, counts]) => ({ state, ...withPercentage(counts) }))
          .sort(byTotalDesc),
        entityWiseCompliance: Array.from(entityMap.values())
          .map((item) => ({ ...item, ...withPercentage(item) }))
          .sort(byTotalDesc),
        locationWiseCompliance: Array.from(locationMap.values())
          .map((item) => ({ ...item, ...withPercentage(item) }))
          .sort(byTotalDesc)
          .slice(0, 15),
        categoryWiseCompliance: Array.from(categoryMap.entries())
          .map(([categoryId, counts]) => ({
            categoryId,
            name: categoryLabels.get(categoryId) || 'Uncategorised',
            ...withPercentage(counts),
          }))
          .sort(byTotalDesc),
        upcomingExpiries,
        taskWorkload,
        overdueAgeing,
      },
      alerts: alerts.slice(0, 8),
    };
  }

  /**
   * Selectable filter options, limited to the caller's scope
   */
  public static async getFilterOptions(scope: AccessScope = { unrestricted: true }): Promise<{
    states: string[];
    entities: Array<{ _id: string; name: string; code: string; state?: string }>;
    locations: Array<{ _id: string; name: string; code: string; entityId: string; state?: string }>;
    categories: Array<{ _id: string; name: string; code: string }>;
  }> {
    const [entities, locations, categories] = await Promise.all([
      Entity.find({ $and: [{ status: 'active' }, entityScopeFilter(scope)] })
        .select('name code address.state')
        .sort({ name: 1 })
        .lean(),
      Location.find({ $and: [{ status: 'active' }, locationScopeFilter(scope)] })
        .select('name code entity address.state')
        .sort({ name: 1 })
        .lean(),
      MasterData.find({ category: 'compliance_category', status: 'active' })
        .select('label code')
        .sort({ label: 1 })
        .lean(),
    ]);

    // States come from locations, which is where compliance records are attributed
    const states = new Set<string>();
    for (const location of locations) {
      if (location.address?.state) states.add(location.address.state.trim());
    }

    return {
      states: Array.from(states).sort(),
      entities: entities.map((e) => ({
        _id: e._id.toString(),
        name: e.name,
        code: e.code,
        state: e.address?.state,
      })),
      locations: locations.map((l) => ({
        _id: l._id.toString(),
        name: l.name,
        code: l.code,
        entityId: l.entity?.toString() || '',
        state: l.address?.state,
      })),
      categories: categories.map((c) => ({
        _id: c._id.toString(),
        name: c.label,
        code: c.code,
      })),
    };
  }
}

export const dashboardService = DashboardService;
