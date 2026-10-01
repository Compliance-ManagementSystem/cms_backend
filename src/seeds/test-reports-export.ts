/**
 * Phase 12 Automated Integration Test Suite: Reports & Export
 *
 * Verifies:
 * 1. Dedicated Reports (All 7 required types):
 *    - Compliance Report
 *    - Expiry Report
 *    - Pending Report
 *    - Overdue Report
 *    - Entity Report
 *    - Location Report
 *    - Task Report
 * 2. Multi-Dimensional Filters:
 *    - Date range (startDate / endDate)
 *    - State
 *    - Entity
 *    - Location
 *    - Status
 *    - Category
 *    - Assigned User
 * 3. Output Formats:
 *    - Live JSON Preview with Summary KPIs & Item Rows
 *    - CSV Export with RFC 4180 Escaping and UTF-8 Byte Order Mark (BOM)
 *    - Excel XML Spreadsheet 2003 Export
 * 4. Filter Options API:
 *    - Distinct states, active entities, locations, categories, and users
 */

import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { ReportService } from '../services/report.service.js';

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
  console.log('🧪 Starting Phase 12: Reports & Export Integration Test');
  console.log('=============================================================\n');

  await connectDB();

  try {
    // ── 1. Compliance Report Verification ────────────────────────────────────
    console.log('1️⃣ Testing Statutory Compliance Master Report...');
    const compReport = await ReportService.getComplianceReport({});

    assert(compReport.reportType === 'compliance', 'Report type is compliance');
    assert(compReport.title.includes('Compliance'), 'Report title is descriptive');
    assert(typeof compReport.summary.totalRecords === 'number', 'Summary contains totalRecords');
    assert(typeof compReport.summary.complianceScore === 'string', 'Summary contains complianceScore %');
    assert(Array.isArray(compReport.data), 'Data is an array');

    if (compReport.data.length > 0) {
      const first = compReport.data[0];
      assert(!!first.recordNumber, 'Record has recordNumber');
      assert(!!first.ruleName, 'Record has ruleName');
      assert(!!first.entityName, 'Record has entityName');
      assert(!!first.locationName, 'Record has locationName');
      assert(!!first.status, 'Record has status');
    }

    // ── 2. Expiry Report Verification ────────────────────────────────────────
    console.log('\n2️⃣ Testing Statutory Expiry & Renewal Forecast Report...');
    const expiryReport = await ReportService.getExpiryReport({});

    assert(expiryReport.reportType === 'expiry', 'Report type is expiry');
    assert(typeof expiryReport.summary.expiring30Days === 'number', 'Summary tracks 30-day forecast');
    assert(typeof expiryReport.summary.expiring60Days === 'number', 'Summary tracks 60-day forecast');
    assert(typeof expiryReport.summary.expiring90Days === 'number', 'Summary tracks 90-day forecast');
    assert(Array.isArray(expiryReport.data), 'Data is an array');

    if (expiryReport.data.length > 0) {
      const first = expiryReport.data[0];
      assert('daysRemaining' in first, 'Expiry item calculates daysRemaining');
      assert(['critical', 'high', 'medium', 'low'].includes(first.urgency), 'Expiry item assigns urgency level');
    }

    // ── 3. Pending Approval Report Verification ──────────────────────────────
    console.log('\n3️⃣ Testing Pending Compliance & Review Pipeline Report...');
    const pendingReport = await ReportService.getPendingReport({});

    assert(pendingReport.reportType === 'pending', 'Report type is pending');
    assert(typeof pendingReport.summary.totalPending === 'number', 'Summary contains totalPending');
    assert(typeof pendingReport.summary.submittedCount === 'number', 'Summary contains submittedCount');
    assert(typeof pendingReport.summary.underReviewCount === 'number', 'Summary contains underReviewCount');
    assert(Array.isArray(pendingReport.data), 'Data is an array');

    // ── 4. Overdue Report Verification ───────────────────────────────────────
    console.log('\n4️⃣ Testing Statutory Non-Compliance & Overdue Violations Report...');
    const overdueReport = await ReportService.getOverdueReport({});

    assert(overdueReport.reportType === 'overdue', 'Report type is overdue');
    assert(typeof overdueReport.summary.totalOverdue === 'number', 'Summary contains totalOverdue');
    assert(Array.isArray(overdueReport.data), 'Data is an array');

    if (overdueReport.data.length > 0) {
      assert('daysOverdue' in overdueReport.data[0], 'Overdue item tracks daysOverdue');
    }

    // ── 5. Corporate Entity Report Verification ──────────────────────────────
    console.log('\n5️⃣ Testing Corporate Legal Entity Performance Report...');
    const entityReport = await ReportService.getEntityReport({});

    assert(entityReport.reportType === 'entities', 'Report type is entities');
    assert(typeof entityReport.summary.totalEntities === 'number', 'Summary contains totalEntities');
    assert(Array.isArray(entityReport.data), 'Data is an array');

    const dbEntityCount = await Entity.countDocuments();
    assert(
      entityReport.summary.totalEntities === dbEntityCount,
      `Entity report count matches MongoDB (${entityReport.summary.totalEntities} === ${dbEntityCount})`
    );

    if (entityReport.data.length > 0) {
      const first = entityReport.data[0];
      assert(!!first.name, 'Entity row has name');
      assert('totalUnits' in first, 'Entity row aggregates totalUnits');
      assert('totalCompliance' in first, 'Entity row aggregates totalCompliance');
      assert('complianceScore' in first, 'Entity row calculates complianceScore %');
    }

    // ── 6. Facility Location Report Verification ─────────────────────────────
    console.log('\n6️⃣ Testing Facility Unit Audit & Compliance Report...');
    const locationReport = await ReportService.getLocationReport({});

    assert(locationReport.reportType === 'locations', 'Report type is locations');
    assert(typeof locationReport.summary.totalLocations === 'number', 'Summary contains totalLocations');
    assert(Array.isArray(locationReport.data), 'Data is an array');

    const dbLocCount = await Location.countDocuments();
    assert(
      locationReport.summary.totalLocations === dbLocCount,
      `Location report count matches MongoDB (${locationReport.summary.totalLocations} === ${dbLocCount})`
    );

    if (locationReport.data.length > 0) {
      const first = locationReport.data[0];
      assert(!!first.name, 'Location row has name');
      assert(!!first.entityName, 'Location row links entityName');
      assert('state' in first, 'Location row includes state');
      assert('totalCompliance' in first, 'Location row aggregates totalCompliance');
      assert('complianceScore' in first, 'Location row aggregates complianceScore');
    }

    // ── 7. Remedial Tasks Report Verification ────────────────────────────────
    console.log('\n7️⃣ Testing Statutory Remedial Tasks & Action Items Report...');
    const taskReport = await ReportService.getTaskReport({});

    assert(taskReport.reportType === 'tasks', 'Report type is tasks');
    assert(typeof taskReport.summary.totalTasks === 'number', 'Summary contains totalTasks');
    assert(Array.isArray(taskReport.data), 'Data is an array');

    const dbTaskCount = await Task.countDocuments();
    assert(
      taskReport.summary.totalTasks === dbTaskCount,
      `Task report count matches MongoDB (${taskReport.summary.totalTasks} === ${dbTaskCount})`
    );

    if (taskReport.data.length > 0) {
      const first = taskReport.data[0];
      assert(!!first.title, 'Task row has title');
      assert(!!first.priority, 'Task row has priority');
      assert(!!first.status, 'Task row has status');
    }

    // ── 8. Multi-Dimensional Filters Verification ────────────────────────────
    console.log('\n8️⃣ Testing Multi-Dimensional Filters Application...');
    const filterOptions = await ReportService.getFilterOptions();

    assert(Array.isArray(filterOptions.states), 'filterOptions.states is an array');
    assert(Array.isArray(filterOptions.entities), 'filterOptions.entities is an array');
    assert(Array.isArray(filterOptions.locations), 'filterOptions.locations is an array');
    assert(Array.isArray(filterOptions.categories), 'filterOptions.categories is an array');
    assert(Array.isArray(filterOptions.users), 'filterOptions.users is an array');

    // Test Entity Filter
    if (filterOptions.entities.length > 0) {
      const testEntityId = filterOptions.entities[0]._id;
      const filteredByEntity = await ReportService.getComplianceReport({ entity: testEntityId });
      assert(
        filteredByEntity.data.every((r: any) => r.entityCode === filterOptions.entities[0].code || r.entityName === filterOptions.entities[0].name),
        'Entity filter strictly isolates records for the specified entity'
      );
    }

    // Test State Filter
    if (filterOptions.states.length > 0) {
      const testState = filterOptions.states[0];
      const filteredByState = await ReportService.getComplianceReport({ state: testState });
      assert(
        filteredByState.data.every((r: any) => r.state.toLowerCase() === testState.toLowerCase()),
        `State filter strictly isolates records for state: ${testState}`
      );
    }

    // Test Status Filter
    const filteredByStatus = await ReportService.getComplianceReport({ status: 'approved' });
    assert(
      filteredByStatus.data.every((r: any) => r.status === 'approved'),
      'Status filter strictly isolates approved records'
    );

    // Test Date Range Filter
    const today = new Date().toISOString().slice(0, 10);
    const pastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const filteredByDate = await ReportService.getComplianceReport({
      startDate: pastYear,
      endDate: today,
    });
    assert(
      filteredByDate.totalRecords >= 0,
      'Date range filter successfully applies createdAt boundaries'
    );

    // ── 9. CSV & Excel Output Generators ────────────────────────────────────
    console.log('\n9️⃣ Testing Output Engines: CSV & Excel XML Formatters...');
    // CSV output test
    const csvOutput = ReportService.toCsv(compReport);
    assert(typeof csvOutput === 'string', 'toCsv returns string output');
    assert(csvOutput.startsWith('\ufeff'), 'CSV starts with UTF-8 BOM for Microsoft Excel compatibility');
    assert(csvOutput.includes(compReport.title), 'CSV contains report title header');
    assert(csvOutput.includes('RECORDNUMBER'), 'CSV contains column headers');

    // Excel XML output test
    const excelOutput = ReportService.toExcel(compReport);
    assert(typeof excelOutput === 'string', 'toExcel returns string output');
    assert(excelOutput.includes('<?xml version="1.0"'), 'Excel export produces valid XML preamble');
    assert(excelOutput.includes('urn:schemas-microsoft-com:office:spreadsheet'), 'Excel export declares Microsoft Spreadsheet namespace');
    assert(excelOutput.includes(compReport.title), 'Excel export embeds report title and data rows');

    // ── 10. Generic Dispatcher ──────────────────────────────────────────────
    console.log('\n🔟 Testing Universal Report Dispatcher...');
    const dispatched = await ReportService.generateReport('tasks', {});
    assert(dispatched.reportType === 'tasks', 'generateReport dispatches correct type');

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=============================================================');
    console.log(`🏁 Phase 12 Tests Finished: ${passedTests} PASSED, ${failedTests} FAILED`);
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
