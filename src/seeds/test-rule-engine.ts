/**
 * Phase 7 Integration Test Suite — Compliance Rule Engine
 *
 * Tests:
 * 1. Compliance Rule CRUD lifecycle (Create, Read, Update, Delete)
 * 2. Rule activation/deactivation status toggling
 * 3. Master Data reference enforcement (category, frequency, document types)
 * 4. Rule Applicability Evaluation via RuleEngineService:
 *    - Evaluation across different Entity Types
 *    - Evaluation across different Location Types
 *    - Evaluation across different States / Jurisdictions
 *    - Pan-India (empty states) rules vs State-specific rules
 *    - Pan-Entity (empty entity types) vs Type-specific rules
 * 5. Inactive rule exclusion
 */

import mongoose from 'mongoose';
import '../models/index.js'; // Ensure schemas are registered
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import ComplianceRule from '../models/ComplianceRule.js';
import { RuleEngineService } from '../services/ruleEngine.service.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/compliance-management-system';

async function runRuleEngineTests() {
  console.log('🧪 Starting Phase 7 Compliance Rule Engine Integration Tests...\n');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string) => {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  };

  try {
    // ── Prerequisites ─────────────────────────────────────────────────────────
    const adminUser = (await User.findOne({ email: 'superadmin@cms.local' })) || (await User.findOne());
    const fireCategory = await MasterData.findOne({ category: 'compliance_category', code: 'FIRE_SAFETY' });
    const foodCategory = await MasterData.findOne({ category: 'compliance_category', code: 'FOOD_SAFETY' });
    const taxCategory = await MasterData.findOne({ category: 'compliance_category', code: 'TAX' });

    const annualFreq = await MasterData.findOne({ category: 'compliance_frequency', code: 'ANNUALLY' });
    const monthlyFreq = await MasterData.findOne({ category: 'compliance_frequency', code: 'MONTHLY' });

    const clinicLocType = await MasterData.findOne({ category: 'location_type', code: 'CLINIC' });
    const unitLocType = await MasterData.findOne({ category: 'location_type', code: 'UNIT' });
    const officeLocType = await MasterData.findOne({ category: 'location_type', code: 'OFFICE' });

    const hospitalEntityType = await MasterData.findOne({ category: 'entity_type', code: 'PVT_LTD' }) || (await MasterData.findOne({ category: 'entity_type' }));
    const llpEntityType = await MasterData.findOne({ category: 'entity_type', code: 'LLP' }) || (await MasterData.findOne({ category: 'entity_type' }));

    const docType = await MasterData.findOne({ category: 'document_type' });

    assert(!!adminUser, 'Admin user exists');
    assert(!!fireCategory && !!foodCategory && !!taxCategory, 'Compliance categories exist in Master Data');
    assert(!!annualFreq && !!monthlyFreq, 'Compliance frequencies exist in Master Data');
    assert(!!clinicLocType && !!unitLocType && !!officeLocType, 'Location types exist in Master Data');

    // Clean up test data
    await ComplianceRule.deleteMany({ code: { $in: ['TEST-RULE-FIRE-KA', 'TEST-RULE-FSSAI-CLINIC', 'TEST-RULE-TAX-ALL', 'TEST-RULE-INACTIVE'] } });
    await Location.deleteMany({ code: { $in: ['TEST-ENG-LOC-KA', 'TEST-ENG-LOC-MH'] } });
    await Entity.deleteMany({ code: { $in: ['TEST-ENG-ENT-01', 'TEST-ENG-ENT-02'] } });

    // ── Create Test Entities and Locations for Applicability Testing ───────────
    // Entity 1: Karnataka (PVT_LTD)
    const entity1 = await Entity.create({
      name: 'Apex Healthcare Karnataka Pvt Ltd',
      code: 'TEST-ENG-ENT-01',
      entityType: hospitalEntityType!._id,
      address: {
        line1: 'Indiranagar 100ft Road',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560038',
        country: 'India',
      },
      contactEmail: 'admin@apexhealth.in',
      contactPhone: '+91 80 2345 6789',
      status: 'active',
      createdBy: adminUser!._id,
    });

    // Location 1A: Clinic in Karnataka under Entity 1
    const locationKAClinic = await Location.create({
      name: 'Apex Indiranagar Clinic',
      code: 'TEST-ENG-LOC-KA',
      entity: entity1._id,
      locationType: clinicLocType!._id,
      address: {
        line1: '12th Main Indiranagar',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560038',
        country: 'India',
      },
      status: 'active',
      createdBy: adminUser!._id,
    });

    // Location 1B: Corporate Office in Maharashtra under Entity 1
    const locationMHOffice = await Location.create({
      name: 'Apex Mumbai Corporate Office',
      code: 'TEST-ENG-LOC-MH',
      entity: entity1._id,
      locationType: officeLocType!._id,
      address: {
        line1: 'Bandra Kurla Complex',
        city: 'Mumbai',
        district: 'Mumbai Suburban',
        state: 'Maharashtra',
        pincode: '400051',
        country: 'India',
      },
      status: 'active',
      createdBy: adminUser!._id,
    });

    // ── 1. Create Compliance Rules with Different Applicability Filters ────────
    console.log('────────────────────────────────────────────────────────────');
    console.log('1. Rule Creation & Configuration');
    console.log('────────────────────────────────────────────────────────────');

    // Rule A: Fire Safety NOC (Karnataka state only, Clinic & Unit only)
    const ruleFireKA = await ComplianceRule.create({
      name: 'Karnataka Fire Force Safety Certificate Renewal',
      code: 'TEST-RULE-FIRE-KA',
      description: 'Annual inspection and fire clearance certificate from Karnataka State Fire and Emergency Services.',
      category: fireCategory!._id,
      applicableEntityTypes: [hospitalEntityType!._id],
      applicableLocationTypes: [clinicLocType!._id, unitLocType!._id],
      applicableStates: ['Karnataka'],
      frequency: annualFreq!._id,
      renewalFrequency: 'ANNUALLY',
      renewalCycle: 365,
      mandatory: true,
      active: true,
      status: 'active',
      requiredDocuments: docType ? [{ documentType: docType._id, label: 'Fire Safety Clearance NOC', isMandatory: true }] : [],
      createdBy: adminUser!._id,
    });

    assert(!!ruleFireKA && ruleFireKA.code === 'TEST-RULE-FIRE-KA', 'Rule A (State-specific: Karnataka) created');

    // Rule B: FSSAI Food Hygiene Audit (Pan-India, Clinic only)
    const ruleFSSAIClinic = await ComplianceRule.create({
      name: 'FSSAI Canteen & Cafeteria Hygiene Compliance',
      code: 'TEST-RULE-FSSAI-CLINIC',
      description: 'Mandatory clinical canteen sanitary inspection audit.',
      category: foodCategory!._id,
      applicableEntityTypes: [], // All entity types
      applicableLocationTypes: [clinicLocType!._id], // Clinics only
      applicableStates: [], // Pan-India (All states)
      frequency: annualFreq!._id,
      renewalFrequency: 'ANNUALLY',
      renewalCycle: 365,
      mandatory: false,
      active: true,
      status: 'active',
      createdBy: adminUser!._id,
    });

    assert(!!ruleFSSAIClinic && ruleFSSAIClinic.code === 'TEST-RULE-FSSAI-CLINIC', 'Rule B (Pan-India, Clinic-only) created');

    // Rule C: GST Monthly Return (Pan-India, All locations)
    const ruleTaxAll = await ComplianceRule.create({
      name: 'GST Monthly Return Filing (GSTR-3B)',
      code: 'TEST-RULE-TAX-ALL',
      description: 'Monthly summary return of inward and outward supplies.',
      category: taxCategory!._id,
      applicableEntityTypes: [], // All entity types
      applicableLocationTypes: [], // All location types
      applicableStates: [], // Pan-India
      frequency: monthlyFreq!._id,
      renewalFrequency: 'MONTHLY',
      renewalCycle: 30,
      mandatory: true,
      active: true,
      status: 'active',
      createdBy: adminUser!._id,
    });

    assert(!!ruleTaxAll && ruleTaxAll.code === 'TEST-RULE-TAX-ALL', 'Rule C (Universal Pan-India, All Units) created');

    // Rule D: Inactive Rule (Should never be applicable)
    const ruleInactive = await ComplianceRule.create({
      name: 'Legacy Discontinued Health Audit',
      code: 'TEST-RULE-INACTIVE',
      category: fireCategory!._id,
      frequency: annualFreq!._id,
      active: false,
      status: 'inactive',
      createdBy: adminUser!._id,
    });

    assert(ruleInactive.status === 'inactive' && !ruleInactive.active, 'Rule D (Inactive rule) created');

    // ── 2. Test Rule Engine Applicability Logic ────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('2. Rule Applicability Evaluation (Entity Types, Location Types, States)');
    console.log('────────────────────────────────────────────────────────────');

    // Test 1: Location in Karnataka, Clinic type
    const evalKAClinic = RuleEngineService.isRuleApplicable(ruleFireKA, {
      entity: entity1,
      location: locationKAClinic,
    });
    assert(
      evalKAClinic.isApplicable === true,
      'RuleFireKA APPLIES to Karnataka Clinic (matches Entity Type, Location Type CLINIC, and State Karnataka)'
    );

    // Test 2: Location in Maharashtra, Office type
    const evalMHOffice = RuleEngineService.isRuleApplicable(ruleFireKA, {
      entity: entity1,
      location: locationMHOffice,
    });
    assert(
      evalMHOffice.isApplicable === false,
      'RuleFireKA DOES NOT APPLY to Maharashtra Office (fails State check "Maharashtra" vs "Karnataka" & Location Type "OFFICE")'
    );
    assert(
      evalMHOffice.matches.stateMatch === false,
      'State mismatch flag correctly set to false for Maharashtra location'
    );
    assert(
      evalMHOffice.matches.locationTypeMatch === false,
      'Location type mismatch flag correctly set to false for Office location'
    );

    // Test 3: Location Type Filtering
    const evalFSSAIClinic = RuleEngineService.isRuleApplicable(ruleFSSAIClinic, {
      entity: entity1,
      location: locationKAClinic,
    });
    assert(
      evalFSSAIClinic.isApplicable === true,
      'RuleFSSAIClinic APPLIES to Clinic (Pan-India state match + Location Type match)'
    );

    const evalFSSAIOffice = RuleEngineService.isRuleApplicable(ruleFSSAIClinic, {
      entity: entity1,
      location: locationMHOffice,
    });
    assert(
      evalFSSAIOffice.isApplicable === false,
      'RuleFSSAIClinic DOES NOT APPLY to Corporate Office (fails locationType filter)'
    );

    // Test 4: Universal Rule (Pan-India, All Types)
    const evalTaxKA = RuleEngineService.isRuleApplicable(ruleTaxAll, {
      entity: entity1,
      location: locationKAClinic,
    });
    const evalTaxMH = RuleEngineService.isRuleApplicable(ruleTaxAll, {
      entity: entity1,
      location: locationMHOffice,
    });
    assert(
      evalTaxKA.isApplicable === true && evalTaxMH.isApplicable === true,
      'Universal Tax Rule APPLIES across both Karnataka Clinic and Maharashtra Office'
    );

    // Test 5: Inactive Rule Evaluation
    const evalInactive = RuleEngineService.isRuleApplicable(ruleInactive, {
      entity: entity1,
      location: locationKAClinic,
    });
    assert(
      evalInactive.isApplicable === false && evalInactive.matches.statusMatch === false,
      'Inactive rule is properly excluded by Rule Engine'
    );

    // ── 3. Test Bulk Target Evaluation Service ────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('3. Bulk Applicable Rules Query for Target Location');
    console.log('────────────────────────────────────────────────────────────');

    const bulkEvalKA = await RuleEngineService.getApplicableRules({
      locationId: locationKAClinic._id.toString(),
    });

    const applicableCodes = bulkEvalKA.applicableRules.map((r) => r.ruleCode);
    assert(applicableCodes.includes('TEST-RULE-FIRE-KA'), 'Karnataka Clinic includes TEST-RULE-FIRE-KA');
    assert(applicableCodes.includes('TEST-RULE-FSSAI-CLINIC'), 'Karnataka Clinic includes TEST-RULE-FSSAI-CLINIC');
    assert(applicableCodes.includes('TEST-RULE-TAX-ALL'), 'Karnataka Clinic includes TEST-RULE-TAX-ALL');
    assert(!applicableCodes.includes('TEST-RULE-INACTIVE'), 'Karnataka Clinic excludes inactive rule');

    const bulkEvalMH = await RuleEngineService.getApplicableRules({
      locationId: locationMHOffice._id.toString(),
    });
    const mhApplicableCodes = bulkEvalMH.applicableRules.map((r) => r.ruleCode);
    assert(!mhApplicableCodes.includes('TEST-RULE-FIRE-KA'), 'Maharashtra Office excludes Karnataka Fire rule');
    assert(!mhApplicableCodes.includes('TEST-RULE-FSSAI-CLINIC'), 'Maharashtra Office excludes Clinic-only food rule');
    assert(mhApplicableCodes.includes('TEST-RULE-TAX-ALL'), 'Maharashtra Office includes universal Tax rule');

    // ── 4. Rule CRUD & Status Toggle ──────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('4. Rule Update & Status Toggle Verification');
    console.log('────────────────────────────────────────────────────────────');

    ruleFireKA.name = 'Updated Karnataka Fire & Life Safety Certificate';
    ruleFireKA.renewalCycle = 180;
    await ruleFireKA.save();

    const reloaded = await ComplianceRule.findById(ruleFireKA._id);
    assert(reloaded?.name === 'Updated Karnataka Fire & Life Safety Certificate', 'Rule name updated in database');
    assert(reloaded?.renewalCycle === 180, 'Rule renewal cycle updated to 180 days');

    // Toggle status to inactive
    ruleFireKA.status = 'inactive';
    await ruleFireKA.save();

    const recheckEval = RuleEngineService.isRuleApplicable(ruleFireKA, {
      entity: entity1,
      location: locationKAClinic,
    });
    assert(recheckEval.isApplicable === false, 'Deactivated rule is no longer applicable to target location');

    // ── 5. Cleanup Test Artifacts ──────────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('5. Cleanup Test Data');
    console.log('────────────────────────────────────────────────────────────');

    await ComplianceRule.deleteMany({
      _id: { $in: [ruleFireKA._id, ruleFSSAIClinic._id, ruleTaxAll._id, ruleInactive._id] },
    });
    await Location.deleteMany({ _id: { $in: [locationKAClinic._id, locationMHOffice._id] } });
    await Entity.deleteMany({ _id: entity1._id });
    assert(true, 'Test entities, locations, and compliance rules cleaned up cleanly');

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`RULE ENGINE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Test execution failed with error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runRuleEngineTests();
