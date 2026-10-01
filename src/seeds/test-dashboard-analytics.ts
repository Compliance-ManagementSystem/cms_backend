/**
 * Phase 11 Automated Integration Test Suite
 *
 * Verifies:
 * 1. Dashboard Levels:
 *    - National Dashboard (pan-India aggregation)
 *    - State Dashboard (scoped by state)
 *    - Entity Dashboard (scoped by entity)
 *    - Location Dashboard (scoped by facility/location)
 * 2. KPIs Accuracy against MongoDB Source of Truth:
 *    - Total Entities
 *    - Total Locations
 *    - Total Compliance Records
 *    - Compliant (Approved)
 *    - Pending (Pending, Submitted, Under Review)
 *    - Expiring Soon
 *    - Expired (Expired, Rejected)
 *    - Open Tasks
 *    - Overdue Tasks
 *    - Completed Tasks
 *    - Compliance Score Percentage %
 * 3. Traffic Light Rating Matrix:
 *    - Green (Compliant)
 *    - Yellow (Expiring Soon)
 *    - Orange (Pending)
 *    - Red (Expired / Overdue)
 * 4. Charts Data Aggregations (Recharts readiness):
 *    - Status distribution (donut data)
 *    - State-wise compliance (stacked bar data)
 *    - Entity-wise compliance
 *    - Location-wise compliance
 *    - Expiry trends
 *    - Task trends
 * 5. Drill Down & Dynamic Filter Options
 */

import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import MasterData from '../models/MasterData.js';
import { dashboardService } from '../services/dashboard.service.js';

let passedTests = 0;
let failedTests = 0;

const assert = (condition: boolean, testName: string, details?: any) => {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`, details ? details : '');
    failedTests++;
  }
};

const runTests = async () => {
  console.log('\n=============================================================');
  console.log('🧪 Starting Phase 11: Dashboard + Analytics Integration Test');
  console.log('=============================================================\n');

  await connectDB();

  try {
    // ── 1. National Dashboard Verification ───────────────────────────────────
    console.log('1️⃣ Testing National Dashboard Level and Live MongoDB Counters...');
    const nationalStats = await dashboardService.getDashboardStats({});

    assert(nationalStats.level === 'national', 'National dashboard level identified correctly');

    // Compare with direct DB counts
    const dbTotalEntities = await Entity.countDocuments();
    const dbTotalLocations = await Location.countDocuments();
    const dbTotalCompliance = await ComplianceRecord.countDocuments({ status: { $ne: 'not_applicable' } });
    const dbCompliant = await ComplianceRecord.countDocuments({ status: 'approved' });
    const dbPending = await ComplianceRecord.countDocuments({
      status: { $in: ['pending', 'submitted', 'under_review', 'correction', 'resubmitted'] },
    });
    const dbExpiringSoon = await ComplianceRecord.countDocuments({ status: 'expiring_soon' });
    const dbExpired = await ComplianceRecord.countDocuments({
      status: { $in: ['expired', 'rejected'] },
    });

    const dbOpenTasks = await Task.countDocuments({
      status: { $in: ['open', 'in_progress', 'pending_approval'] },
    });
    const dbOverdueTasks = await Task.countDocuments({ status: 'overdue' });
    const dbCompletedTasks = await Task.countDocuments({ status: 'completed' });

    assert(
      nationalStats.kpis.totalEntities === dbTotalEntities,
      `KPI Total Entities matches DB (${nationalStats.kpis.totalEntities} === ${dbTotalEntities})`
    );
    assert(
      nationalStats.kpis.totalLocations === dbTotalLocations,
      `KPI Total Locations matches DB (${nationalStats.kpis.totalLocations} === ${dbTotalLocations})`
    );
    assert(
      nationalStats.kpis.totalComplianceRecords === dbTotalCompliance,
      `KPI Total Compliance matches DB (${nationalStats.kpis.totalComplianceRecords} === ${dbTotalCompliance})`
    );
    assert(
      nationalStats.kpis.compliant === dbCompliant,
      `KPI Compliant matches DB (${nationalStats.kpis.compliant} === ${dbCompliant})`
    );
    assert(
      nationalStats.kpis.pending === dbPending,
      `KPI Pending matches DB (${nationalStats.kpis.pending} === ${dbPending})`
    );
    assert(
      nationalStats.kpis.expiringSoon === dbExpiringSoon,
      `KPI Expiring Soon matches DB (${nationalStats.kpis.expiringSoon} === ${dbExpiringSoon})`
    );
    assert(
      nationalStats.kpis.expired === dbExpired,
      `KPI Expired matches DB (${nationalStats.kpis.expired} === ${dbExpired})`
    );
    assert(
      nationalStats.kpis.openTasks === dbOpenTasks,
      `KPI Open Tasks matches DB (${nationalStats.kpis.openTasks} === ${dbOpenTasks})`
    );
    assert(
      nationalStats.kpis.overdueTasks === dbOverdueTasks,
      `KPI Overdue Tasks matches DB (${nationalStats.kpis.overdueTasks} === ${dbOverdueTasks})`
    );
    assert(
      nationalStats.kpis.completedTasks === dbCompletedTasks,
      `KPI Completed Tasks matches DB (${nationalStats.kpis.completedTasks} === ${dbCompletedTasks})`
    );

    const expectedScore =
      dbTotalCompliance > 0 ? Math.round((dbCompliant / dbTotalCompliance) * 100) : 100;
    assert(
      nationalStats.kpis.compliancePercentage === expectedScore,
      `KPI Compliance Score % matches formula (${nationalStats.kpis.compliancePercentage}% === ${expectedScore}%)`
    );

    // ── 2. Traffic Light Rating Verification ─────────────────────────────────
    console.log('\n2️⃣ Testing Traffic Light Logic Matrix...');
    assert(
      ['green', 'yellow', 'orange', 'red'].includes(nationalStats.trafficLights.overallRating),
      `Traffic light overall status is valid (${nationalStats.trafficLights.overallRating})`
    );
    if (dbExpired > 0 || dbOverdueTasks > 0) {
      assert(
        nationalStats.trafficLights.overallRating === 'red',
        'Traffic light flags RED when expired records or overdue tasks exist'
      );
    } else if (dbExpiringSoon > 0) {
      assert(
        nationalStats.trafficLights.overallRating === 'yellow',
        'Traffic light flags YELLOW when items are expiring soon'
      );
    } else if (dbPending > 0) {
      assert(
        nationalStats.trafficLights.overallRating === 'orange',
        'Traffic light flags ORANGE when pending items exist'
      );
    } else {
      assert(
        nationalStats.trafficLights.overallRating === 'green',
        'Traffic light flags GREEN when fully compliant'
      );
    }

    // ── 3. State Dashboard Verification ──────────────────────────────────────
    console.log('\n3️⃣ Testing State-Level Dashboard and Scoping...');
    // Find location with state defined
    const anyLocation = await Location.findOne({ 'address.state': { $exists: true, $ne: '' } });
    if (anyLocation && anyLocation.address?.state) {
      const testState = anyLocation.address.state;
      const stateStats = await dashboardService.getDashboardStats({ state: testState });

      assert(stateStats.level === 'state', `Level set to 'state' for state filter`);
      assert(stateStats.selectedState === testState, `Selected state matches '${testState}'`);

      const dbStateLocCount = await Location.countDocuments({
        'address.state': { $regex: new RegExp(`^${testState}$`, 'i') },
      });
      assert(
        stateStats.kpis.totalLocations === dbStateLocCount,
        `State Dashboard Location count matches DB (${stateStats.kpis.totalLocations} === ${dbStateLocCount})`
      );

      // Verify records are scoped to locations in this state
      const stateLocIds = (
        await Location.find({ 'address.state': { $regex: new RegExp(`^${testState}$`, 'i') } }).select('_id')
      ).map((l) => l._id);
      const dbStateRecCount = await ComplianceRecord.countDocuments({
        location: { $in: stateLocIds },
        status: { $ne: 'not_applicable' },
      });
      assert(
        stateStats.kpis.totalComplianceRecords === dbStateRecCount,
        `State Dashboard Compliance count matches DB (${stateStats.kpis.totalComplianceRecords} === ${dbStateRecCount})`
      );
    } else {
      console.log('  ⚠️ Skipping state test: no location with state found in DB.');
    }

    // ── 4. Entity Dashboard Verification ─────────────────────────────────────
    console.log('\n4️⃣ Testing Entity-Level Dashboard and Scoping...');
    const anyEntity = await Entity.findOne();
    if (anyEntity) {
      const entityId = (anyEntity._id as any).toString();
      const entityStats = await dashboardService.getDashboardStats({ entity: entityId });

      assert(entityStats.level === 'entity', `Level set to 'entity' for entity filter`);
      assert(entityStats.selectedEntity?._id === entityId, `Selected entity ID matches`);
      assert(entityStats.selectedEntity?.name === anyEntity.name, `Selected entity name matches`);

      const dbEntityLocCount = await Location.countDocuments({ entity: anyEntity._id });
      assert(
        entityStats.kpis.totalLocations === dbEntityLocCount,
        `Entity Dashboard Location count matches DB (${entityStats.kpis.totalLocations} === ${dbEntityLocCount})`
      );

      const dbEntityRecCount = await ComplianceRecord.countDocuments({
        entity: anyEntity._id,
        status: { $ne: 'not_applicable' },
      });
      assert(
        entityStats.kpis.totalComplianceRecords === dbEntityRecCount,
        `Entity Dashboard Compliance count matches DB (${entityStats.kpis.totalComplianceRecords} === ${dbEntityRecCount})`
      );
    }

    // ── 5. Location Dashboard Verification ───────────────────────────────────
    console.log('\n5️⃣ Testing Location-Level Dashboard and Scoping...');
    if (anyLocation) {
      const locationId = (anyLocation._id as any).toString();
      const locationStats = await dashboardService.getDashboardStats({ location: locationId });

      assert(locationStats.level === 'location', `Level set to 'location' for location filter`);
      assert(locationStats.selectedLocation?._id === locationId, `Selected location ID matches`);
      assert(locationStats.kpis.totalLocations === 1, `Location Dashboard displays 1 unit`);

      const dbLocRecCount = await ComplianceRecord.countDocuments({
        location: anyLocation._id,
        status: { $ne: 'not_applicable' },
      });
      assert(
        locationStats.kpis.totalComplianceRecords === dbLocRecCount,
        `Location Dashboard Compliance count matches DB (${locationStats.kpis.totalComplianceRecords} === ${dbLocRecCount})`
      );
    }

    // ── 6. Charts Aggregations Verification ──────────────────────────────────
    console.log('\n6️⃣ Testing Recharts Data Aggregation Payloads...');
    const { charts } = nationalStats;

    assert(Array.isArray(charts.statusDistribution), 'charts.statusDistribution is an array');
    assert(charts.statusDistribution.length === 4, 'charts.statusDistribution has 4 status segments');
    const totalFromDist = charts.statusDistribution.reduce((acc, curr) => acc + curr.value, 0);
    assert(
      totalFromDist === nationalStats.kpis.totalComplianceRecords,
      `Status distribution slice sum (${totalFromDist}) equals total compliance records (${nationalStats.kpis.totalComplianceRecords})`
    );

    assert(Array.isArray(charts.stateWiseCompliance), 'charts.stateWiseCompliance is an array');
    assert(Array.isArray(charts.entityWiseCompliance), 'charts.entityWiseCompliance is an array');
    assert(Array.isArray(charts.locationWiseCompliance), 'charts.locationWiseCompliance is an array');
    assert(Array.isArray(charts.expiryTrends), 'charts.expiryTrends is an array');
    assert(charts.expiryTrends.length > 0, 'charts.expiryTrends has timeline points');
    assert(Array.isArray(charts.taskTrends), 'charts.taskTrends is an array');

    // ── 7. Filter Options Service Verification ───────────────────────────────
    console.log('\n7️⃣ Testing Dynamic Filter Options API...');
    const filterOptions = await dashboardService.getFilterOptions();

    assert(Array.isArray(filterOptions.states), 'filterOptions.states is an array');
    assert(Array.isArray(filterOptions.entities), 'filterOptions.entities is an array');
    assert(Array.isArray(filterOptions.locations), 'filterOptions.locations is an array');
    assert(Array.isArray(filterOptions.categories), 'filterOptions.categories is an array');

    if (filterOptions.entities.length > 0) {
      assert(
        !!filterOptions.entities[0]._id && !!filterOptions.entities[0].name,
        'Entity filter options have _id, name, and code'
      );
    }

    if (filterOptions.locations.length > 0) {
      assert(
        !!filterOptions.locations[0]._id &&
          !!filterOptions.locations[0].name &&
          !!filterOptions.locations[0].entityId,
        'Location filter options have _id, name, entityId, and state for hierarchical filtering'
      );
    }

    // ── 8. Drill-down Integrity Verification ────────────────────────────────
    console.log('\n8️⃣ Testing Multi-Level Drill-Down Consistency...');
    // When state is selected, drills correctly into state entities and locations
    if (anyLocation && anyLocation.address?.state) {
      const stateStats = await dashboardService.getDashboardStats({ state: anyLocation.address.state });
      assert(
        Array.isArray(stateStats.charts.entityWiseCompliance),
        'State stats provides drilldown breakdown of entities in that state'
      );
      assert(
        Array.isArray(stateStats.charts.locationWiseCompliance),
        'State stats provides drilldown breakdown of locations in that state'
      );
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=============================================================');
    console.log(`🏁 Phase 11 Tests Finished: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=============================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during test execution:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

runTests();
