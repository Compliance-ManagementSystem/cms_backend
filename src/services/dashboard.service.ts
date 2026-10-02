import { Types } from 'mongoose';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import ComplianceRule from '../models/ComplianceRule.js';
import Task, { ACTIVE_TASK_STATUSES, isTaskOverdue, overdueTaskFilter } from '../models/Task.js';
import MasterData from '../models/MasterData.js';

export interface DashboardFilters {
  state?: string;
  entity?: string;
  location?: string;
  category?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  period?: '30d' | '90d' | '1y' | 'all';
}

export type DashboardLevel = 'national' | 'state' | 'entity' | 'location';

export interface DashboardKPIs {
  totalEntities: number;
  totalLocations: number;
  totalComplianceRecords: number;
  compliant: number;
  pending: number;
  expiringSoon: number;
  expired: number;
  compliancePercentage: number;
  overdueTasks: number;
  openTasks: number;
  completedTasks: number;
}

export interface TrafficLightSummary {
  overallRating: 'green' | 'yellow' | 'orange' | 'red';
  green: number;   // Compliant
  yellow: number;  // Expiring soon
  orange: number;  // Pending
  red: number;     // Expired / Overdue
}

export interface StatusDistributionItem {
  name: string;
  value: number;
  color: string;
  statusKey: string;
}

export interface StateComplianceItem {
  state: string;
  total: number;
  compliant: number;
  pending: number;
  expiringSoon: number;
  expired: number;
  percentage: number;
}

export interface EntityComplianceItem {
  entityId: string;
  name: string;
  code: string;
  total: number;
  compliant: number;
  pending: number;
  expiringSoon: number;
  expired: number;
  percentage: number;
}

export interface LocationComplianceItem {
  locationId: string;
  name: string;
  code: string;
  entityName: string;
  state: string;
  total: number;
  compliant: number;
  pending: number;
  expiringSoon: number;
  expired: number;
  percentage: number;
}

export interface ExpiryTrendItem {
  month: string;
  expiring: number;
  expired: number;
  renewed: number;
}

export interface TaskTrendItem {
  month: string;
  open: number;
  completed: number;
  overdue: number;
}

export interface DashboardData {
  level: DashboardLevel;
  selectedState?: string;
  selectedEntity?: { _id: string; name: string; code: string };
  selectedLocation?: { _id: string; name: string; code: string };
  kpis: DashboardKPIs;
  trafficLights: TrafficLightSummary;
  charts: {
    statusDistribution: StatusDistributionItem[];
    stateWiseCompliance: StateComplianceItem[];
    entityWiseCompliance: EntityComplianceItem[];
    locationWiseCompliance: LocationComplianceItem[];
    expiryTrends: ExpiryTrendItem[];
    taskTrends: TaskTrendItem[];
  };
  criticalAlerts: Array<{
    id: string;
    type: 'expired_compliance' | 'overdue_task' | 'missing_docs' | 'expiring_soon';
    title: string;
    entityName: string;
    locationName: string;
    severity: 'critical' | 'high' | 'medium';
    date: Date;
    recordId?: string;
    taskId?: string;
  }>;
}

export class DashboardService {
  /**
   * Main aggregation query engine for Dashboard & Analytics
   */
  public static async getDashboardStats(filters: DashboardFilters = {}): Promise<DashboardData> {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // ── 1. Determine Dashboard Level ─────────────────────────────────────────
    let level: DashboardLevel = 'national';
    if (filters.location) {
      level = 'location';
    } else if (filters.entity) {
      level = 'entity';
    } else if (filters.state) {
      level = 'state';
    }

    // ── 2. Resolve matching Location & Entity IDs based on filters ───────────
    const locationQuery: any = { status: 'active' };
    const entityQuery: any = { status: 'active' };

    if (filters.state) {
      locationQuery['address.state'] = { $regex: new RegExp(`^${filters.state}$`, 'i') };
      entityQuery['address.state'] = { $regex: new RegExp(`^${filters.state}$`, 'i') };
    }

    if (filters.entity) {
      const entityObjId = new Types.ObjectId(filters.entity);
      locationQuery.entity = entityObjId;
      entityQuery._id = entityObjId;
    }

    if (filters.location) {
      locationQuery._id = new Types.ObjectId(filters.location);
    }

    // Fetch matched locations and entities
    const [matchingLocations, matchingEntities] = await Promise.all([
      Location.find(locationQuery).select('_id name code entity address').lean(),
      Entity.find(entityQuery).select('_id name code address').lean(),
    ]);

    const matchingLocationIds = matchingLocations.map((l) => l._id);
    const matchingEntityIds = filters.entity
      ? [new Types.ObjectId(filters.entity)]
      : matchingEntities.map((e) => e._id);

    // ── 3. Build Compliance Record Match Filter ──────────────────────────────
    const recordMatch: any = {
      status: { $ne: 'not_applicable' },
    };

    if (filters.location) {
      recordMatch.location = new Types.ObjectId(filters.location);
    } else if (filters.state) {
      if (matchingLocationIds.length > 0) {
        recordMatch.location = { $in: matchingLocationIds };
      } else {
        recordMatch.location = new Types.ObjectId();
      }
    }

    if (filters.entity) {
      recordMatch.entity = new Types.ObjectId(filters.entity);
    }

    if (filters.status) {
      recordMatch.status = filters.status;
    }

    // Date range filter
    if (filters.startDate || filters.endDate) {
      recordMatch.createdAt = {};
      if (filters.startDate) recordMatch.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) recordMatch.createdAt.$lte = new Date(filters.endDate);
    } else if (filters.period) {
      let days = 30;
      if (filters.period === '90d') days = 90;
      if (filters.period === '1y') days = 365;
      if (filters.period !== 'all') {
        const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        recordMatch.createdAt = { $gte: periodStart };
      }
    }

    // Category filter (via ComplianceRule)
    if (filters.category) {
      const categoryObjId = new Types.ObjectId(filters.category);
      const rulesWithCategory = await ComplianceRule.find({ category: categoryObjId }).distinct('_id');
      recordMatch.rule = { $in: rulesWithCategory };
    }

    // ── 4. Aggregate Compliance Records ──────────────────────────────────────
    const allRecords = await ComplianceRecord.find(recordMatch)
      .populate('entity', 'name code entityCode')
      .populate('location', 'name code locationCode address')
      .populate('rule', 'name code category')
      .lean();

    const totalRecords = allRecords.length;

    let compliantCount = 0;
    let pendingCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;

    for (const rec of allRecords) {
      if (rec.status === 'approved') {
        compliantCount++;
      } else if (rec.status === 'expiring_soon') {
        expiringSoonCount++;
      } else if (rec.status === 'expired' || rec.status === 'rejected') {
        expiredCount++;
      } else {
        // 'pending', 'submitted', 'under_review', 'correction', 'resubmitted'
        pendingCount++;
      }
    }

    const compliancePercentage =
      totalRecords > 0 ? Math.round((compliantCount / totalRecords) * 100) : 100;

    // ── 5. Aggregate Task Statistics ─────────────────────────────────────────
    const taskMatch: any = {};
    if (filters.location) {
      taskMatch.location = new Types.ObjectId(filters.location);
    } else if (filters.state) {
      if (matchingLocationIds.length > 0) {
        taskMatch.location = { $in: matchingLocationIds };
      } else {
        taskMatch.location = new Types.ObjectId();
      }
    }
    if (filters.entity) {
      taskMatch.entity = new Types.ObjectId(filters.entity);
    }

    const [openTasks, completedTasks, overdueTasks] = await Promise.all([
      Task.countDocuments({
        ...taskMatch,
        status: { $in: ACTIVE_TASK_STATUSES },
      }),
      Task.countDocuments({ ...taskMatch, status: 'completed' }),
      Task.countDocuments({
        ...taskMatch,
        ...overdueTaskFilter(),
      }),
    ]);

    // ── 6. Traffic Lights Summary ────────────────────────────────────────────
    let overallRating: 'green' | 'yellow' | 'orange' | 'red' = 'green';
    if (expiredCount > 0 || overdueTasks > 0 || compliancePercentage < 60) {
      overallRating = 'red';
    } else if (pendingCount > 0 && compliancePercentage < 80) {
      overallRating = 'orange';
    } else if (expiringSoonCount > 0 || compliancePercentage < 90) {
      overallRating = 'yellow';
    }

    const trafficLights: TrafficLightSummary = {
      overallRating,
      green: compliantCount,
      yellow: expiringSoonCount,
      orange: pendingCount,
      red: expiredCount + overdueTasks,
    };

    // ── 7. Charts Data ───────────────────────────────────────────────────────

    // Status Distribution (Donut Chart)
    const statusDistribution: StatusDistributionItem[] = [
      { name: 'Compliant', value: compliantCount, color: '#10b981', statusKey: 'approved' },
      { name: 'Expiring Soon', value: expiringSoonCount, color: '#f59e0b', statusKey: 'expiring_soon' },
      { name: 'Pending Action', value: pendingCount, color: '#f97316', statusKey: 'pending' },
      { name: 'Expired / Overdue', value: expiredCount, color: '#ef4444', statusKey: 'expired' },
    ];

    // State-wise compliance aggregation
    const stateMap = new Map<string, { total: number; compliant: number; pending: number; expiring: number; expired: number }>();

    for (const rec of allRecords) {
      const loc = rec.location as any;
      const stateName = loc?.address?.state || 'Unassigned';
      if (!stateMap.has(stateName)) {
        stateMap.set(stateName, { total: 0, compliant: 0, pending: 0, expiring: 0, expired: 0 });
      }
      const st = stateMap.get(stateName)!;
      st.total++;

      const expiry = rec.expiryDate ? new Date(rec.expiryDate) : null;
      if (rec.status === 'approved') {
        st.compliant++;
      } else if (rec.status === 'expired' || rec.status === 'rejected') {
        st.expired++;
      } else if (rec.status === 'expiring_soon') {
        st.expiring++;
      } else {
        st.pending++;
      }
    }

    const stateWiseCompliance: StateComplianceItem[] = Array.from(stateMap.entries())
      .map(([state, data]) => ({
        state,
        total: data.total,
        compliant: data.compliant,
        pending: data.pending,
        expiringSoon: data.expiring,
        expired: data.expired,
        percentage: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Entity-wise compliance aggregation
    const entityMap = new Map<string, { name: string; code: string; total: number; compliant: number; pending: number; expiring: number; expired: number }>();

    for (const rec of allRecords) {
      const ent = rec.entity as any;
      const entId = ent?._id?.toString() || 'unknown';
      const entName = ent?.name || 'Unknown Entity';
      const entCode = ent?.entityCode || ent?.code || 'ENT';

      if (!entityMap.has(entId)) {
        entityMap.set(entId, { name: entName, code: entCode, total: 0, compliant: 0, pending: 0, expiring: 0, expired: 0 });
      }
      const item = entityMap.get(entId)!;
      item.total++;

      if (rec.status === 'approved') {
        item.compliant++;
      } else if (rec.status === 'expired' || rec.status === 'rejected') {
        item.expired++;
      } else if (rec.status === 'expiring_soon') {
        item.expiring++;
      } else {
        item.pending++;
      }
    }

    const entityWiseCompliance: EntityComplianceItem[] = Array.from(entityMap.entries())
      .map(([entityId, data]) => ({
        entityId,
        name: data.name,
        code: data.code,
        total: data.total,
        compliant: data.compliant,
        pending: data.pending,
        expiringSoon: data.expiring,
        expired: data.expired,
        percentage: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Location-wise compliance aggregation
    const locationMap = new Map<string, { name: string; code: string; entityName: string; state: string; total: number; compliant: number; pending: number; expiring: number; expired: number }>();

    for (const rec of allRecords) {
      const loc = rec.location as any;
      const ent = rec.entity as any;
      const locId = loc?._id?.toString() || 'unknown';
      const locName = loc?.name || 'Unknown Unit';
      const locCode = loc?.locationCode || loc?.code || 'LOC';
      const stateName = loc?.address?.state || 'Unknown';
      const entityName = ent?.name || '';

      if (!locationMap.has(locId)) {
        locationMap.set(locId, { name: locName, code: locCode, entityName, state: stateName, total: 0, compliant: 0, pending: 0, expiring: 0, expired: 0 });
      }
      const item = locationMap.get(locId)!;
      item.total++;

      if (rec.status === 'approved') {
        item.compliant++;
      } else if (rec.status === 'expired' || rec.status === 'rejected') {
        item.expired++;
      } else if (rec.status === 'expiring_soon') {
        item.expiring++;
      } else {
        item.pending++;
      }
    }

    const locationWiseCompliance: LocationComplianceItem[] = Array.from(locationMap.entries())
      .map(([locationId, data]) => ({
        locationId,
        name: data.name,
        code: data.code,
        entityName: data.entityName,
        state: data.state,
        total: data.total,
        compliant: data.compliant,
        pending: data.pending,
        expiringSoon: data.expiring,
        expired: data.expired,
        percentage: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15); // Top 15 locations for display

    // Expiry Trends (Next 6 months timeline)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const expiryTrends: ExpiryTrendItem[] = [];

    for (let i = -1; i <= 5; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();
      const monthLabel = `${monthNames[targetMonth]} '${String(targetYear).slice(2)}`;

      let expiringInMonth = 0;
      let expiredInMonth = 0;
      let renewedInMonth = 0;

      for (const rec of allRecords) {
        if (rec.expiryDate) {
          const exp = new Date(rec.expiryDate);
          if (exp.getMonth() === targetMonth && exp.getFullYear() === targetYear) {
            if (rec.status === 'approved') {
              expiringInMonth++;
            } else if (rec.status === 'expired' || exp < now) {
              expiredInMonth++;
            }
          }
        }
        if (rec.approvalDate) {
          const app = new Date(rec.approvalDate);
          if (app.getMonth() === targetMonth && app.getFullYear() === targetYear) {
            renewedInMonth++;
          }
        }
      }

      expiryTrends.push({
        month: monthLabel,
        expiring: expiringInMonth,
        expired: expiredInMonth,
        renewed: renewedInMonth,
      });
    }

    // Task Trends (Past 6 months)
    const allTasks = await Task.find(taskMatch).select('status createdAt dueDate completedAt').lean();
    const taskTrends: TaskTrendItem[] = [];

    for (let i = -5; i <= 0; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();
      const monthLabel = `${monthNames[targetMonth]} '${String(targetYear).slice(2)}`;

      let openCount = 0;
      let completedCount = 0;
      let overdueCount = 0;

      for (const t of allTasks) {
        const created = new Date(t.createdAt);
        if (created.getMonth() === targetMonth && created.getFullYear() === targetYear) {
          if (t.status === 'completed') {
            completedCount++;
          } else if (isTaskOverdue(t, now)) {
            overdueCount++;
          } else {
            openCount++;
          }
        }
      }

      taskTrends.push({
        month: monthLabel,
        open: openCount,
        completed: completedCount,
        overdue: overdueCount,
      });
    }

    // ── 8. Critical Alerts ───────────────────────────────────────────────────
    const criticalAlerts: DashboardData['criticalAlerts'] = [];

    // Expired records
    for (const rec of allRecords) {
      const expiry = rec.expiryDate ? new Date(rec.expiryDate) : null;
      if (rec.status === 'expired' || (expiry && expiry < now && rec.status !== 'approved')) {
        criticalAlerts.push({
          id: rec._id.toString(),
          type: 'expired_compliance',
          title: `Expired Statutory Obligation: ${(rec.rule as any)?.name || 'Compliance'}`,
          entityName: (rec.entity as any)?.name || 'General Entity',
          locationName: (rec.location as any)?.name || 'General Location',
          severity: 'critical',
          date: expiry || now,
          recordId: rec._id.toString(),
        });
      }
    }

    // Overdue tasks
    const urgentTasks = await Task.find({
      ...taskMatch,
      status: { $in: ACTIVE_TASK_STATUSES },
      $or: [{ priority: 'critical' }, { dueDate: { $lt: new Date() } }],
    })
      .populate('entity', 'name')
      .populate('location', 'name')
      .sort({ dueDate: 1 })
      .limit(10)
      .lean();

    for (const t of urgentTasks) {
      criticalAlerts.push({
        id: t._id.toString(),
        type: 'overdue_task',
        title: t.title,
        entityName: (t.entity as any)?.name || 'General Entity',
        locationName: (t.location as any)?.name || 'General Location',
        severity: t.priority === 'critical' ? 'critical' : 'high',
        date: t.dueDate ? new Date(t.dueDate) : new Date(t.createdAt),
        taskId: t._id.toString(),
      });
    }

    // Sort alerts by urgency
    criticalAlerts.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return a.date.getTime() - b.date.getTime();
    });

    // Selected object lookups for breadcrumbs
    let selectedEntity: any;
    if (filters.entity) {
      selectedEntity = await Entity.findById(filters.entity).select('_id name code entityCode').lean();
    }
    let selectedLocation: any;
    if (filters.location) {
      selectedLocation = await Location.findById(filters.location).select('_id name code locationCode').lean();
    }

    const totalEntitiesCount = filters.entity
      ? 1
      : await Entity.countDocuments(entityQuery);

    const totalLocationsCount = filters.location
      ? 1
      : await Location.countDocuments(locationQuery);

    return {
      level,
      selectedState: filters.state,
      selectedEntity: selectedEntity
        ? {
            _id: selectedEntity._id.toString(),
            name: selectedEntity.name,
            code: selectedEntity.entityCode || selectedEntity.code,
          }
        : undefined,
      selectedLocation: selectedLocation
        ? {
            _id: selectedLocation._id.toString(),
            name: selectedLocation.name,
            code: selectedLocation.locationCode || selectedLocation.code,
          }
        : undefined,
      kpis: {
        totalEntities: totalEntitiesCount,
        totalLocations: totalLocationsCount,
        totalComplianceRecords: totalRecords,
        compliant: compliantCount,
        pending: pendingCount,
        expiringSoon: expiringSoonCount,
        expired: expiredCount,
        compliancePercentage,
        overdueTasks,
        openTasks,
        completedTasks,
      },
      trafficLights,
      charts: {
        statusDistribution,
        stateWiseCompliance,
        entityWiseCompliance,
        locationWiseCompliance,
        expiryTrends,
        taskTrends,
      },
      criticalAlerts: criticalAlerts.slice(0, 8),
    };
  }

  /**
   * Returns list of selectable filter criteria
   */
  public static async getFilterOptions(): Promise<{
    states: string[];
    entities: Array<{ _id: string; name: string; code: string; state?: string }>;
    locations: Array<{ _id: string; name: string; code: string; entityId: string; state?: string }>;
    categories: Array<{ _id: string; name: string; code: string }>;
  }> {
    const [entities, locations, categories] = await Promise.all([
      Entity.find({ status: 'active' }).select('_id name code entityCode address').sort({ name: 1 }).lean(),
      Location.find({ status: 'active' }).select('_id name code locationCode entity address').sort({ name: 1 }).lean(),
      MasterData.find({ category: 'compliance_category', status: 'active' }).select('_id name code').sort({ name: 1 }).lean(),
    ]);

    // Distinct states from entities and locations
    const stateSet = new Set<string>();
    for (const e of entities) {
      if (e.address?.state) stateSet.add(e.address.state.trim());
    }
    for (const l of locations) {
      if (l.address?.state) stateSet.add(l.address.state.trim());
    }

    return {
      states: Array.from(stateSet).sort(),
      entities: entities.map((e) => ({
        _id: e._id.toString(),
        name: e.name,
        code: (e as any).entityCode || e.code,
        state: e.address?.state,
      })),
      locations: locations.map((l) => ({
        _id: l._id.toString(),
        name: l.name,
        code: (l as any).locationCode || l.code,
        entityId: (l.entity as any)?._id?.toString() || (l.entity as any)?.toString() || '',
        state: l.address?.state,
      })),
      categories: categories.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        code: c.code,
      })),
    };
  }
}

export const dashboardService = DashboardService;
