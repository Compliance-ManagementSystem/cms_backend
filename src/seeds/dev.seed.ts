/**
 * Development Seed Script
 *
 * Creates minimal reference data to verify model creation, relationships,
 * and indexes across all 19 collections. ONLY for development use.
 *
 * Run with: npm run seed:dev
 *
 * WARNING: Clears all existing data before seeding!
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ── Import all 19 models (registration order matters) ────────────────────────
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import User from '../models/User.js';
import MasterData from '../models/MasterData.js';
import EntityType from '../models/EntityType.js';
import LocationType from '../models/LocationType.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRule from '../models/ComplianceRule.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Licence from '../models/Licence.js';
import CmsDocument from '../models/Document.js';
import DocumentVersion from '../models/DocumentVersion.js';
import Workflow from '../models/Workflow.js';
import Approval from '../models/Approval.js';
import Task from '../models/Task.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import Settings from '../models/Settings.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/compliance-management-system';

// ── Helpers ───────────────────────────────────────────────────────────────────

const log = (msg: string) => console.log(`  ✓ ${msg}`);
const section = (title: string) =>
  console.log(`\n${'─'.repeat(50)}\n  ${title}\n${'─'.repeat(50)}`);

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Starting development seed (All 19 Models)...\n');

  await mongoose.connect(MONGODB_URI);
  console.log(`✅ Connected to: ${MONGODB_URI}\n`);

  // ── 1. Clear all 19 collections ───────────────────────────────────────────
  section('1. Clearing all collections');
  await Promise.all([
    Permission.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
    MasterData.deleteMany({}),
    EntityType.deleteMany({}),
    LocationType.deleteMany({}),
    Entity.deleteMany({}),
    Location.deleteMany({}),
    ComplianceRule.deleteMany({}),
    ComplianceRecord.deleteMany({}),
    Licence.deleteMany({}),
    CmsDocument.deleteMany({}),
    DocumentVersion.deleteMany({}),
    Workflow.deleteMany({}),
    Approval.deleteMany({}),
    Task.deleteMany({}),
    Notification.deleteMany({}),
    AuditLog.deleteMany({}),
    Settings.deleteMany({}),
  ]);
  log('All 19 collections cleared');

  // ── 2. Permissions Catalog ────────────────────────────────────────────────
  section('2. Permissions Catalog');

  const permissions = await Permission.insertMany([
    // Core Entity & Location
    { name: 'Read Entity', code: 'entity:read', module: 'entity', action: 'read' },
    { name: 'Create Entity', code: 'entity:create', module: 'entity', action: 'create' },
    { name: 'Update Entity', code: 'entity:update', module: 'entity', action: 'update' },
    { name: 'Delete Entity', code: 'entity:delete', module: 'entity', action: 'delete' },
    { name: 'Read Location', code: 'location:read', module: 'location', action: 'read' },
    { name: 'Create Location', code: 'location:create', module: 'location', action: 'create' },
    { name: 'Update Location', code: 'location:update', module: 'location', action: 'update' },
    { name: 'Delete Location', code: 'location:delete', module: 'location', action: 'delete' },

    // Compliance & Governance
    { name: 'Read Compliance', code: 'compliance:read', module: 'compliance', action: 'read' },
    { name: 'Create Compliance', code: 'compliance:create', module: 'compliance', action: 'create' },
    { name: 'Update Compliance', code: 'compliance:update', module: 'compliance', action: 'update' },
    { name: 'Approve Compliance', code: 'compliance:approve', module: 'compliance', action: 'approve' },
    { name: 'Manage Tasks', code: 'task:manage', module: 'task', action: 'update' },
    { name: 'View Audit Logs', code: 'audit:read', module: 'audit', action: 'read' },

    // Administration & Master Data (Phase 4)
    { name: 'Read Users', code: 'user:read', module: 'user', action: 'read' },
    { name: 'Create User', code: 'user:create', module: 'user', action: 'create' },
    { name: 'Update User', code: 'user:update', module: 'user', action: 'update' },
    { name: 'Delete User', code: 'user:delete', module: 'user', action: 'delete' },

    { name: 'Read Roles', code: 'role:read', module: 'role', action: 'read' },
    { name: 'Create Role', code: 'role:create', module: 'role', action: 'create' },
    { name: 'Update Role', code: 'role:update', module: 'role', action: 'update' },
    { name: 'Delete Role', code: 'role:delete', module: 'role', action: 'delete' },

    { name: 'Read Permissions', code: 'permission:read', module: 'permission', action: 'read' },
    { name: 'Create Permission', code: 'permission:create', module: 'permission', action: 'create' },
    { name: 'Update Permission', code: 'permission:update', module: 'permission', action: 'update' },

    { name: 'Read Master Data', code: 'master_data:read', module: 'master_data', action: 'read' },
    { name: 'Create Master Data', code: 'master_data:create', module: 'master_data', action: 'create' },
    { name: 'Update Master Data', code: 'master_data:update', module: 'master_data', action: 'update' },
    { name: 'Delete Master Data', code: 'master_data:delete', module: 'master_data', action: 'delete' },

    { name: 'Read Settings', code: 'settings:read', module: 'settings', action: 'read' },
    { name: 'Update Settings', code: 'settings:update', module: 'settings', action: 'update' },
  ]);
  log(`${permissions.length} granular permissions created in catalog`);

  // ── 3. Roles ──────────────────────────────────────────────────────────────
  section('3. Roles (All 6 Canonical System Roles)');

  const [
    superAdminRole,
    adminRole,
    entityAdminRole,
    locationManagerRole,
    complianceOfficerRole,
    viewerRole,
  ] = await Role.insertMany([
    {
      name: 'Super Admin',
      code: 'super_admin',
      description: 'National control plane with unrestricted global access to all entities, settings, and audits.',
      isSystem: true,
      permissions: [{ resource: '*', actions: ['create', 'read', 'update', 'delete', 'approve', 'assign', 'export'] }],
      status: 'active',
    },
    {
      name: 'Admin',
      code: 'admin',
      description: 'System administrator across all entities with operational and user management privileges.',
      isSystem: true,
      permissions: [
        { resource: 'entity', actions: ['read', 'update'] },
        { resource: 'location', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'compliance_rule', actions: ['create', 'read', 'update'] },
        { resource: 'compliance_record', actions: ['create', 'read', 'update', 'approve'] },
        { resource: 'licence', actions: ['create', 'read', 'update', 'renew'] },
        { resource: 'document', actions: ['upload', 'read', 'update', 'download'] },
        { resource: 'task', actions: ['create', 'read', 'update', 'assign'] },
        { resource: 'approval', actions: ['read', 'approve', 'reject'] },
        { resource: 'user', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'role', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'permission', actions: ['create', 'read', 'update'] },
        { resource: 'master_data', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'audit_log', actions: ['read', 'export'] },
        { resource: 'settings', actions: ['read', 'update'] },
      ],
      status: 'active',
    },
    {
      name: 'Entity Admin',
      code: 'entity_admin',
      description: 'Administrator for a specific entity. Manages entity locations, users, and compliance.',
      isSystem: true,
      permissions: [
        { resource: 'entity', actions: ['read'] },
        { resource: 'location', actions: ['create', 'read', 'update'] },
        { resource: 'compliance_rule', actions: ['read'] },
        { resource: 'compliance_record', actions: ['create', 'read', 'update', 'approve'] },
        { resource: 'licence', actions: ['create', 'read', 'update', 'renew'] },
        { resource: 'document', actions: ['upload', 'read', 'update', 'download'] },
        { resource: 'task', actions: ['create', 'read', 'update', 'assign'] },
        { resource: 'approval', actions: ['read', 'approve', 'reject'] },
        { resource: 'user', actions: ['create', 'read', 'update'] },
        { resource: 'audit_log', actions: ['read'] },
      ],
      status: 'active',
    },
    {
      name: 'Unit/Location Manager',
      code: 'location_manager',
      description: 'Manages an assigned physical unit/clinic. Coordinates onsite tasks, evidence uploads, and renewal requests.',
      isSystem: true,
      permissions: [
        { resource: 'location', actions: ['read'] },
        { resource: 'compliance_record', actions: ['read', 'submit'] },
        { resource: 'licence', actions: ['read'] },
        { resource: 'document', actions: ['upload', 'read', 'download'] },
        { resource: 'task', actions: ['read', 'update'] },
        { resource: 'notification', actions: ['read'] },
      ],
      status: 'active',
    },
    {
      name: 'Compliance Officer',
      code: 'compliance_officer',
      description: 'Specialist managing compliance verification, regulatory filing, evidence audits, and rule execution.',
      isSystem: true,
      permissions: [
        { resource: 'entity', actions: ['read'] },
        { resource: 'location', actions: ['read'] },
        { resource: 'compliance_rule', actions: ['read'] },
        { resource: 'compliance_record', actions: ['create', 'read', 'update', 'submit'] },
        { resource: 'licence', actions: ['create', 'read', 'update', 'renew'] },
        { resource: 'document', actions: ['upload', 'read', 'update', 'download'] },
        { resource: 'task', actions: ['create', 'read', 'update'] },
        { resource: 'approval', actions: ['read'] },
        { resource: 'audit_log', actions: ['read'] },
      ],
      status: 'active',
    },
    {
      name: 'Viewer',
      code: 'viewer',
      description: 'Read-only stakeholder. Can view dashboards, compliance statuses, and reports without write capability.',
      isSystem: true,
      permissions: [
        { resource: 'entity', actions: ['read'] },
        { resource: 'location', actions: ['read'] },
        { resource: 'compliance_rule', actions: ['read'] },
        { resource: 'compliance_record', actions: ['read'] },
        { resource: 'licence', actions: ['read'] },
        { resource: 'document', actions: ['read'] },
        { resource: 'task', actions: ['read'] },
      ],
      status: 'active',
    },
  ]);
  log(`6 roles created: super_admin, admin, entity_admin, location_manager, compliance_officer, viewer`);

  // ── 4. Entity Types & Location Types ──────────────────────────────────────
  section('4. Entity Types & Location Types');

  const [entityTypeCCPL, entityTypeCPPL, entityTypeCTPL] = await EntityType.insertMany([
    { name: 'CCPL Healthcare Pvt Ltd', code: 'CCPL', industry: 'Healthcare', isSystem: true, status: 'active' },
    { name: 'CPPL Pharmaceuticals Pvt Ltd', code: 'CPPL', industry: 'Pharma', isSystem: true, status: 'active' },
    { name: 'CTPL Diagnostics Pvt Ltd', code: 'CTPL', industry: 'Diagnostics', isSystem: true, status: 'active' },
  ]);
  log(`3 entity types created: CCPL, CPPL, CTPL`);

  const [locTypeUnit, locTypeClinic, locTypeOffice] = await LocationType.insertMany([
    { name: 'Operating Unit', code: 'UNIT', isSystem: true, status: 'active' },
    { name: 'Healthcare Clinic', code: 'CLINIC', isSystem: true, status: 'active' },
    { name: 'Corporate Office', code: 'OFFICE', isSystem: true, status: 'active' },
  ]);
  log(`3 location types created: UNIT, CLINIC, OFFICE`);

  // ── 5. Master Data (All 12 Categories) ────────────────────────────────────
  section('5. Master Data (All 12 Categories)');

  // 5a. Non-hierarchical categories + States
  const baseMasterData = await MasterData.insertMany([
    // 1. Entity types
    { category: 'entity_type', code: 'CCPL', label: 'CCPL Healthcare', description: 'Primary hospital & clinic cluster', sortOrder: 1, isSystem: true },
    { category: 'entity_type', code: 'CPPL', label: 'CPPL Pharmaceuticals', description: 'Pharmaceutical formulation and distribution', sortOrder: 2, isSystem: true },
    { category: 'entity_type', code: 'CTPL', label: 'CTPL Diagnostics', description: 'Pathology and radiology laboratories', sortOrder: 3, isSystem: true },
    { category: 'entity_type', code: 'TRUST', label: 'Charitable Healthcare Trust', description: 'Non-profit healthcare operations', sortOrder: 4, isSystem: false },
    { category: 'entity_type', code: 'LLP', label: 'Specialty Care LLP', description: 'Specialized medical partnership', sortOrder: 5, isSystem: false },

    // 2. Location types
    { category: 'location_type', code: 'UNIT', label: 'Operating Unit', description: 'Full-service inpatient healthcare unit', sortOrder: 1, isSystem: true },
    { category: 'location_type', code: 'CLINIC', label: 'Outpatient Clinic', description: 'Day clinic for consultations and minor procedures', sortOrder: 2, isSystem: true },
    { category: 'location_type', code: 'OFFICE', label: 'Corporate Office', description: 'Administrative and executive headquarters', sortOrder: 3, isSystem: true },
    { category: 'location_type', code: 'WAREHOUSE', label: 'Central Distribution Warehouse', description: 'Storage facility for medical devices and pharma', sortOrder: 4, isSystem: false },
    { category: 'location_type', code: 'R_AND_D', label: 'R&D Center', description: 'Research and clinical trials facility', sortOrder: 5, isSystem: false },

    // 3. Compliance categories
    { category: 'compliance_category', code: 'FOOD_SAFETY', label: 'Food Safety', description: 'FSSAI hygiene, canteen, and food handling', sortOrder: 1, isSystem: true },
    { category: 'compliance_category', code: 'FIRE_SAFETY', label: 'Fire Safety', description: 'NOC, fire drills, and suppression equipment', sortOrder: 2, isSystem: true },
    { category: 'compliance_category', code: 'TAX', label: 'Tax & Regulatory', description: 'GST, TDS, direct and indirect taxation filings', sortOrder: 3, isSystem: true },
    { category: 'compliance_category', code: 'LABOUR', label: 'Labour Law & Welfare', description: 'PF, ESI, gratuity, factory inspections, workplace safety', sortOrder: 4, isSystem: false },
    { category: 'compliance_category', code: 'ENVIRONMENTAL', label: 'Environmental & Pollution', description: 'Bio-medical waste handling and PCB consents', sortOrder: 5, isSystem: false },
    { category: 'compliance_category', code: 'PHARMACY', label: 'Drug & Pharmacy Regulatory', description: 'Form 20/21 retail drug licences and schedule compliance', sortOrder: 6, isSystem: false },

    // 4. Compliance frequencies
    { category: 'compliance_frequency', code: 'DAILY', label: 'Daily', description: 'Every calendar day inspections / logs', sortOrder: 1, isSystem: true },
    { category: 'compliance_frequency', code: 'WEEKLY', label: 'Weekly', description: 'Weekly checklist verification', sortOrder: 2, isSystem: true },
    { category: 'compliance_frequency', code: 'MONTHLY', label: 'Monthly', description: 'Monthly filings, returns, or internal reviews', sortOrder: 3, isSystem: true },
    { category: 'compliance_frequency', code: 'QUARTERLY', label: 'Quarterly', description: 'Quarterly returns (e.g., GST-1, TDS)', sortOrder: 4, isSystem: true },
    { category: 'compliance_frequency', code: 'HALF_YEARLY', label: 'Half-Yearly', description: 'Bi-annual safety audits and return filings', sortOrder: 5, isSystem: true },
    { category: 'compliance_frequency', code: 'ANNUALLY', label: 'Annually', description: 'Annual regulatory return and renewal', sortOrder: 6, isSystem: true },
    { category: 'compliance_frequency', code: 'BI_ANNUALLY', label: 'Bi-Annually (Every 2 Years)', description: 'Multi-year licence renewals', sortOrder: 7, isSystem: false },
    { category: 'compliance_frequency', code: 'ONETIME', label: 'One-Time Event', description: 'Initial registration or statutory event trigger', sortOrder: 8, isSystem: false },

    // 5. Document types
    { category: 'document_type', code: 'KYC', label: 'KYC Documents', description: 'Entity incorporation, PAN, and identity proofs', sortOrder: 1, isSystem: true },
    { category: 'document_type', code: 'LICENCE_CERT', label: 'Licence Certificate', description: 'Official statutory permit or licence certificate', sortOrder: 2, isSystem: true },
    { category: 'document_type', code: 'COMPLIANCE_CERT', label: 'Compliance Certificate', description: 'Periodic compliance return or validation certificate', sortOrder: 3, isSystem: true },
    { category: 'document_type', code: 'AUDIT_REPORT', label: 'Third-Party Audit Report', description: 'External statutory or ISO audit findings', sortOrder: 4, isSystem: false },
    { category: 'document_type', code: 'INSPECTION_REPORT', label: 'Authority Inspection Report', description: 'Official inspection memo from regulatory bodies', sortOrder: 5, isSystem: false },
    { category: 'document_type', code: 'CHALLAN', label: 'Payment Challan / Receipt', description: 'Treasury or bank receipt for statutory fees', sortOrder: 6, isSystem: false },

    // 6. Licence types
    { category: 'licence_type', code: 'FSSAI', label: 'FSSAI Food Safety Licence', description: 'Central or State food safety handling licence', sortOrder: 1, isSystem: true },
    { category: 'licence_type', code: 'FIRE_NOC', label: 'Fire Safety NOC', description: 'No Objection Certificate from State Fire Service', sortOrder: 2, isSystem: true },
    { category: 'licence_type', code: 'GST_REG', label: 'GST Registration', description: 'Goods & Services Tax identification registration', sortOrder: 3, isSystem: true },
    { category: 'licence_type', code: 'POLLUTION_CTE', label: 'Consent to Establish (CTE)', description: 'State Pollution Control Board establishment consent', sortOrder: 4, isSystem: false },
    { category: 'licence_type', code: 'POLLUTION_CTO', label: 'Consent to Operate (CTO)', description: 'State Pollution Control Board operating consent', sortOrder: 5, isSystem: false },
    { category: 'licence_type', code: 'CLINICAL_EST', label: 'Clinical Establishment Registration', description: 'CEA statutory registration for medical centers', sortOrder: 6, isSystem: false },
    { category: 'licence_type', code: 'DRUG_SALE', label: 'Retail Drug Sale Licence', description: 'Form 20/21 licence for in-hospital pharmacy', sortOrder: 7, isSystem: false },

    // 7. Task priorities
    { category: 'task_priority', code: 'LOW', label: 'Low', description: 'Informational or non-urgent routine checklist item', sortOrder: 1, isSystem: true },
    { category: 'task_priority', code: 'MEDIUM', label: 'Medium', description: 'Standard compliance action due within standard SLAs', sortOrder: 2, isSystem: true },
    { category: 'task_priority', code: 'HIGH', label: 'High', description: 'Urgent action required within 7 days to avoid fine', sortOrder: 3, isSystem: true },
    { category: 'task_priority', code: 'CRITICAL', label: 'Critical', description: 'Immediate escalation — statutory deadline or lapse notice', sortOrder: 4, isSystem: true },

    // 8. Task statuses
    { category: 'task_status', code: 'PENDING', label: 'Pending', description: 'Task queued and awaiting action', sortOrder: 1, isSystem: true },
    { category: 'task_status', code: 'IN_PROGRESS', label: 'In Progress', description: 'Task actively being worked on by assignee', sortOrder: 2, isSystem: true },
    { category: 'task_status', code: 'COMPLETED', label: 'Completed', description: 'Task finished and verified with evidence', sortOrder: 3, isSystem: true },
    { category: 'task_status', code: 'OVERDUE', label: 'Overdue', description: 'Task has passed its due date without completion', sortOrder: 4, isSystem: true },
    { category: 'task_status', code: 'CANCELLED', label: 'Cancelled', description: 'Task revoked or invalidated', sortOrder: 5, isSystem: true },

    // Industries
    { category: 'industry', code: 'HEALTHCARE', label: 'Healthcare', description: 'Hospitals, clinics and care providers', sortOrder: 1, isSystem: true },
    { category: 'industry', code: 'PHARMA', label: 'Pharmaceuticals', description: 'Drug manufacturing and distribution', sortOrder: 2, isSystem: true },
    { category: 'industry', code: 'DIAGNOSTICS', label: 'Diagnostics', description: 'Pathology and radiology laboratories', sortOrder: 3, isSystem: true },
    { category: 'industry', code: 'MANUFACTURING', label: 'Manufacturing', description: 'Factories and production units', sortOrder: 4, isSystem: false },
    { category: 'industry', code: 'IT_SERVICES', label: 'IT & Services', description: 'Technology and professional services', sortOrder: 5, isSystem: false },
    { category: 'industry', code: 'RETAIL', label: 'Retail', description: 'Stores and consumer outlets', sortOrder: 6, isSystem: false },

    // 9. Notification rules
    { category: 'notification_rule', code: 'DUE_IN_90_DAYS', label: '90 Days Before Expiry', description: 'First advance warning for annual renewals', sortOrder: 1, isSystem: true },
    { category: 'notification_rule', code: 'DUE_IN_60_DAYS', label: '60 Days Before Expiry', description: 'Second advance notice for document preparation', sortOrder: 2, isSystem: true },
    { category: 'notification_rule', code: 'DUE_IN_30_DAYS', label: '30 Days Before Expiry', description: 'Urgent notice — trigger application submission', sortOrder: 3, isSystem: true },
    { category: 'notification_rule', code: 'DUE_IN_15_DAYS', label: '15 Days Before Expiry', description: 'Critical reminder with supervisor alert', sortOrder: 4, isSystem: true },
    { category: 'notification_rule', code: 'DUE_IN_7_DAYS', label: '7 Days Before Expiry', description: 'Final countdown notification before lapse', sortOrder: 5, isSystem: true },
    { category: 'notification_rule', code: 'OVERDUE_ALERT', label: 'Immediate Overdue Notice', description: 'Dispatched immediately when statutory expiry is breached', sortOrder: 6, isSystem: true },
    { category: 'notification_rule', code: 'ESCALATION_L1', label: 'Level 1 Escalation Notice', description: 'Escalation to Entity Admin after 3 days overdue', sortOrder: 7, isSystem: false },

    // 10. States
    { category: 'state', code: 'MH', label: 'Maharashtra', description: 'Western Region - Capital: Mumbai', sortOrder: 1, isSystem: true },
    { category: 'state', code: 'KA', label: 'Karnataka', description: 'Southern Region - Capital: Bengaluru', sortOrder: 2, isSystem: true },
    { category: 'state', code: 'DL', label: 'National Capital Territory of Delhi', description: 'Northern Region - Capital: New Delhi', sortOrder: 3, isSystem: true },
    { category: 'state', code: 'GJ', label: 'Gujarat', description: 'Western Region - Capital: Gandhinagar', sortOrder: 4, isSystem: true },
    { category: 'state', code: 'TN', label: 'Tamil Nadu', description: 'Southern Region - Capital: Chennai', sortOrder: 5, isSystem: true },
  ]);

  const stateMH = baseMasterData.find(d => d.category === 'state' && d.code === 'MH')!;
  const stateKA = baseMasterData.find(d => d.category === 'state' && d.code === 'KA')!;
  const stateDL = baseMasterData.find(d => d.category === 'state' && d.code === 'DL')!;
  const stateGJ = baseMasterData.find(d => d.category === 'state' && d.code === 'GJ')!;
  const stateTN = baseMasterData.find(d => d.category === 'state' && d.code === 'TN')!;

  // 11. Districts (with parent state references)
  const districtMasterData = await MasterData.insertMany([
    { category: 'district', code: 'MUMBAI_CITY', label: 'Mumbai City', parent: stateMH._id, sortOrder: 1, isSystem: true },
    { category: 'district', code: 'PUNE', label: 'Pune', parent: stateMH._id, sortOrder: 2, isSystem: true },
    { category: 'district', code: 'THANE', label: 'Thane', parent: stateMH._id, sortOrder: 3, isSystem: false },
    { category: 'district', code: 'BENGALURU_URBAN', label: 'Bengaluru Urban', parent: stateKA._id, sortOrder: 1, isSystem: true },
    { category: 'district', code: 'MYSURU', label: 'Mysuru', parent: stateKA._id, sortOrder: 2, isSystem: false },
    { category: 'district', code: 'NEW_DELHI', label: 'New Delhi', parent: stateDL._id, sortOrder: 1, isSystem: true },
    { category: 'district', code: 'SOUTH_DELHI', label: 'South Delhi', parent: stateDL._id, sortOrder: 2, isSystem: false },
    { category: 'district', code: 'AHMEDABAD', label: 'Ahmedabad', parent: stateGJ._id, sortOrder: 1, isSystem: true },
    { category: 'district', code: 'SURAT', label: 'Surat', parent: stateGJ._id, sortOrder: 2, isSystem: false },
    { category: 'district', code: 'CHENNAI', label: 'Chennai', parent: stateTN._id, sortOrder: 1, isSystem: true },
    { category: 'district', code: 'COIMBATORE', label: 'Coimbatore', parent: stateTN._id, sortOrder: 2, isSystem: false },
  ]);

  const masterDataItems = [...baseMasterData, ...districtMasterData];

  const byCode = (cat: string, code: string) =>
    masterDataItems.find((d) => d.category === cat && d.code === code)!;

  const ccplType = byCode('entity_type', 'CCPL');
  const cpplType = byCode('entity_type', 'CPPL');
  const unitType = byCode('location_type', 'UNIT');
  const clinicType = byCode('location_type', 'CLINIC');
  const officeType = byCode('location_type', 'OFFICE');
  const kycDocType = byCode('document_type', 'KYC');
  const certDocType = byCode('document_type', 'COMPLIANCE_CERT');
  const licenceDocType = byCode('document_type', 'LICENCE_CERT');
  const fssaiType = byCode('licence_type', 'FSSAI');
  const fireCategory = byCode('compliance_category', 'FIRE_SAFETY');
  const foodCategory = byCode('compliance_category', 'FOOD_SAFETY');

  log(`15 MasterData items seeded`);

  // ── 6. Users (All 6 Roles with bcrypt password: Password123!) ──────────────
  section('6. Users (All 6 Roles — Default Password: Password123!)');

  const defaultPassword = 'Password123!';

  const superAdmin = await User.create({
    firstName: 'Aarav',
    lastName: 'Mehta',
    email: 'superadmin@cms.local',
    password: defaultPassword,
    role: superAdminRole._id,
    entity: null,
    isEmailVerified: true,
    status: 'active',
  });
  log(`1. Super Admin:        ${superAdmin.email}`);

  const adminUser = await User.create({
    firstName: 'Vikram',
    lastName: 'Malhotra',
    email: 'admin@cms.local',
    password: defaultPassword,
    role: adminRole._id,
    entity: null,
    isEmailVerified: true,
    status: 'active',
  });
  log(`2. Admin:              ${adminUser.email}`);

  const entityAdmin = await User.create({
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'entityadmin@ccpl.local',
    password: defaultPassword,
    role: entityAdminRole._id,
    isEmailVerified: true,
    status: 'active',
  });
  log(`3. Entity Admin:       ${entityAdmin.email}`);

  const locationManager = await User.create({
    firstName: 'Suresh',
    lastName: 'Patel',
    email: 'locationmanager@ccpl.local',
    password: defaultPassword,
    role: locationManagerRole._id,
    isEmailVerified: true,
    status: 'active',
  });
  log(`4. Location Manager:   ${locationManager.email}`);

  const complianceOfficer = await User.create({
    firstName: 'Rahul',
    lastName: 'Verma',
    email: 'officer@ccpl.local',
    password: defaultPassword,
    role: complianceOfficerRole._id,
    isEmailVerified: true,
    status: 'active',
  });
  log(`5. Compliance Officer: ${complianceOfficer.email}`);

  const viewerUser = await User.create({
    firstName: 'Neha',
    lastName: 'Gupta',
    email: 'viewer@ccpl.local',
    password: defaultPassword,
    role: viewerRole._id,
    isEmailVerified: true,
    status: 'active',
  });
  log(`6. Viewer:             ${viewerUser.email}`);

  // Aliases for downstream seed references
  const complianceManager = complianceOfficer;
  const managerRole = complianceOfficerRole;

  // ── 7. Entity ─────────────────────────────────────────────────────────────
  section('7. Entity (CCPL)');

  const entity = await Entity.create({
    name: 'CCPL Healthcare Pvt Ltd',
    code: 'CCPL',
    entityType: ccplType._id,
    industry: byCode('industry', 'HEALTHCARE')._id,
    registrationNumber: 'U85110MH2020PTC123456',
    gstin: '27AABCC1234D1Z5',
    pan: 'AABCC1234D',
    cin: 'U85110MH2020PTC123456',
    address: {
      line1: 'B-Wing, 4th Floor, Lotus Corporate Park',
      line2: 'Goregaon East',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400063',
      country: 'India',
    },
    contactEmail: 'compliance@ccpl.in',
    contactPhone: '+91 22 4000 1234',
    status: 'active',
    createdBy: superAdmin._id,
  });
  log(`Entity created: ${entity.code} — ${entity.name}`);

  await User.updateMany(
    { _id: { $in: [entityAdmin._id, locationManager._id, complianceOfficer._id, viewerUser._id] } },
    { entity: entity._id }
  );

  // ── 8. Locations ──────────────────────────────────────────────────────────
  section('8. Locations');

  const location1 = await Location.create({
    name: 'Mumbai Unit 1',
    code: 'MUM-U-001',
    entity: entity._id,
    locationType: unitType._id,
    address: {
      line1: 'Unit 12, Ground Floor, Acme Mall',
      line2: 'Andheri West',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400058',
      country: 'India',
    },
    contactPerson: 'Suresh Patel',
    contactEmail: 'mumbai.unit1@ccpl.in',
    contactPhone: '+91 98200 11223',
    area: 4500,
    areaUnit: 'sqft',
    operatingHours: '08:00 - 20:00',
    agreements: [
      {
        agreementType: 'lease',
        agreementNumber: 'AGR-2024-001',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2027-12-31'),
        parties: ['CCPL Healthcare Pvt Ltd', 'Acme Mall Ltd'],
      },
    ],
    status: 'active',
    createdBy: entityAdmin._id,
  });
  log(`Location 1: ${location1.code} — ${location1.name}`);

  locationManager.assignedLocations = [location1._id];
  await locationManager.save();


  const location2 = await Location.create({
    name: 'Pune Clinic 1',
    code: 'PUN-C-001',
    entity: entity._id,
    locationType: clinicType._id,
    address: {
      line1: 'Shop 4, Seasons Business Hub',
      line2: 'Koregaon Park',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India',
    },
    contactPerson: 'Anjali Deshmukh',
    contactEmail: 'pune.clinic1@ccpl.in',
    contactPhone: '+91 98220 33445',
    area: 2200,
    areaUnit: 'sqft',
    operatingHours: '09:00 - 21:00',
    status: 'active',
    createdBy: entityAdmin._id,
  });
  log(`Location 2: ${location2.code} — ${location2.name}`);

  // ── 9. Documents & Document Versions ──────────────────────────────────────
  section('9. Documents & Document Versions');

  const doc1 = await CmsDocument.create({
    title: 'FSSAI Central Licence Certificate',
    documentType: licenceDocType._id,
    description: 'Food Safety and Standards Authority Certificate for Mumbai Unit',
    relatedTo: {
      model: 'Location',
      id: location1._id,
    },
    currentVersion: 1,
    latestVersionUrl: 'https://storage.cms.local/docs/fssai-cert-v1.pdf',
    issueDate: new Date('2025-04-01'),
    expiryDate: new Date('2026-03-31'),
    tags: ['fssai', 'licence', 'mumbai'],
    entity: entity._id,
    location: location1._id,
    versions: [
      {
        version: 1,
        fileUrl: 'https://storage.cms.local/docs/fssai-cert-v1.pdf',
        fileName: 'fssai-cert-mumbai-2025.pdf',
        fileSize: 1048576,
        mimeType: 'application/pdf',
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        uploadedBy: complianceManager._id,
        uploadedAt: new Date('2025-04-02'),
        status: 'active',
      },
    ],
    status: 'active',
    createdBy: complianceManager._id,
  });
  log(`Document created: ${doc1.title}`);

  const docVersion1 = await DocumentVersion.create({
    document: doc1._id,
    version: 1,
    fileUrl: 'https://storage.cms.local/docs/fssai-cert-v1.pdf',
    fileName: 'fssai-cert-mumbai-2025.pdf',
    fileSize: 1048576,
    mimeType: 'application/pdf',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    uploadedBy: complianceManager._id,
    uploadedAt: new Date('2025-04-02'),
    status: 'active',
  });
  log(`DocumentVersion created for version 1`);

  // ── 10. Compliance Rules ──────────────────────────────────────────────────
  section('10. Compliance Rules');

  const fssaiRule = await ComplianceRule.create({
    name: 'FSSAI Food Safety Licence Renewal',
    code: 'FSSAI-ANNUAL',
    category: foodCategory._id,
    description: 'Mandatory annual renewal of Food Safety licence',
    legalReference: 'Food Safety and Standards Act, 2006 — Section 31',
    applicability: {
      entityTypes: [ccplType._id, cpplType._id],
      locationTypes: [unitType._id, clinicType._id],
      states: [],
      industries: [],
    },
    renewalFrequency: 'yearly',
    reminderDaysBefore: [90, 60, 30, 7],
    requiredDocuments: [
      { documentType: licenceDocType._id, label: 'FSSAI Licence Certificate', isMandatory: true },
      { documentType: kycDocType._id, label: 'Premises KYC Documents', isMandatory: true },
    ],
    requiresApproval: true,
    approvalLevels: 2,
    priority: 'high',
    status: 'active',
    createdBy: superAdmin._id,
  });
  log(`Compliance rule: ${fssaiRule.code}`);

  const fireNocRule = await ComplianceRule.create({
    name: 'Fire NOC Renewal',
    code: 'FIRE-NOC-ANNUAL',
    category: fireCategory._id,
    description: 'Annual renewal of Fire No Objection Certificate',
    legalReference: 'Fire Prevention and Life Safety Measures Act',
    applicability: {
      entityTypes: [],
      locationTypes: [unitType._id, clinicType._id, officeType._id],
      states: [],
      industries: [],
    },
    renewalFrequency: 'yearly',
    reminderDaysBefore: [60, 30, 7],
    requiredDocuments: [
      { documentType: certDocType._id, label: 'Fire NOC Certificate', isMandatory: true },
    ],
    requiresApproval: false,
    approvalLevels: 1,
    priority: 'high',
    status: 'active',
    createdBy: superAdmin._id,
  });
  log(`Compliance rule: ${fireNocRule.code}`);

  // ── 11. Compliance Records ────────────────────────────────────────────────
  section('11. Compliance Records');

  const record1 = await ComplianceRecord.create({
    entity: entity._id,
    location: location1._id,
    complianceRule: fssaiRule._id,
    recordNumber: 'CR-2026-00001',
    issueDate: new Date('2025-04-01'),
    expiryDate: new Date('2026-03-31'),
    nextRenewalDate: new Date('2026-01-01'),
    status: 'approved',
    isApplicable: true,
    documents: [doc1._id],
    approvals: [
      {
        level: 1,
        approver: complianceManager._id,
        decision: 'approved',
        comments: 'Documents verified and in order.',
        decidedAt: new Date('2025-04-05'),
        requestedAt: new Date('2025-04-02'),
      },
    ],
    currentApprovalLevel: 1,
    createdBy: complianceManager._id,
  });
  log(`Compliance record: ${record1.recordNumber} → ${record1.status}`);

  const record2 = await ComplianceRecord.create({
    entity: entity._id,
    location: location1._id,
    complianceRule: fireNocRule._id,
    recordNumber: 'CR-2026-00002',
    expiryDate: new Date('2026-06-30'),
    nextRenewalDate: new Date('2026-04-01'),
    status: 'pending',
    isApplicable: true,
    createdBy: complianceManager._id,
  });
  log(`Compliance record: ${record2.recordNumber} → ${record2.status}`);

  const record3 = await ComplianceRecord.create({
    entity: entity._id,
    location: location2._id,
    complianceRule: fssaiRule._id,
    recordNumber: 'CR-2026-00003',
    expiryDate: new Date('2025-12-31'),
    nextRenewalDate: new Date('2025-10-01'),
    status: 'expired',
    isApplicable: true,
    createdBy: complianceManager._id,
  });
  log(`Compliance record: ${record3.recordNumber} → ${record3.status}`);

  // ── 12. Licences ──────────────────────────────────────────────────────────
  section('12. Licences');

  const licence1 = await Licence.create({
    entity: entity._id,
    location: location1._id,
    licenceType: fssaiType._id,
    licenceNumber: 'FSSAI-2025-MH-0012345',
    issuingAuthority: 'FSSAI Central Authority',
    issuingState: 'Maharashtra',
    issueDate: new Date('2025-04-01'),
    expiryDate: new Date('2026-03-31'),
    nextRenewalDate: new Date('2026-01-01'),
    document: doc1._id,
    reminderDaysBefore: [90, 60, 30, 7],
    status: 'active',
    createdBy: complianceManager._id,
  });
  log(`Licence: ${licence1.licenceNumber} → ${licence1.status}`);

  // ── 13. Workflows ─────────────────────────────────────────────────────────
  section('13. Workflows');

  const complianceWorkflow = await Workflow.create({
    name: 'Compliance Sign-off Workflow',
    code: 'COMPLIANCE_SIGN_OFF',
    entity: entity._id,
    module: 'compliance',
    steps: [
      {
        step: 1,
        name: 'Manager Review',
        role: managerRole._id,
        isRequired: true,
        canDelegate: false,
        slaHours: 48,
      },
      {
        step: 2,
        name: 'Admin Approval',
        role: adminRole._id,
        isRequired: true,
        canDelegate: true,
        slaHours: 72,
      },
    ],
    isActive: true,
    status: 'active',
    createdBy: superAdmin._id,
  });
  log(`Workflow: ${complianceWorkflow.code}`);

  // ── 14. Approvals ─────────────────────────────────────────────────────────
  section('14. Approvals');

  const approval1 = await Approval.create({
    entity: entity._id,
    location: location1._id,
    complianceRecord: record1._id,
    level: 1,
    approver: complianceManager._id,
    decision: 'approved',
    comments: 'All compliance certificates verified against MCA & state records.',
    requestedBy: entityAdmin._id,
    requestedAt: new Date('2025-04-02'),
    decidedAt: new Date('2025-04-05'),
    slaHours: 48,
  });
  log(`Approval 1: Level ${approval1.level} → ${approval1.decision}`);

  const approval2 = await Approval.create({
    entity: entity._id,
    location: location1._id,
    complianceRecord: record2._id,
    level: 1,
    approver: entityAdmin._id,
    decision: 'pending',
    comments: 'Awaiting site audit inspection report before sign-off.',
    requestedBy: complianceManager._id,
    requestedAt: new Date('2026-03-01'),
    slaHours: 72,
    dueDate: new Date('2026-03-04'),
  });
  log(`Approval 2: Level ${approval2.level} → ${approval2.decision}`);

  // ── 15. Tasks ─────────────────────────────────────────────────────────────
  section('15. Tasks');

  const task1 = await Task.create({
    title: 'Renew FSSAI Licence for Mumbai Unit 1',
    description: 'Annual FSSAI licence renewal due by March 31, 2026. Upload certificate.',
    taskType: 'renewal',
    entity: entity._id,
    location: location1._id,
    complianceRecord: record1._id,
    licence: licence1._id,
    assignedTo: complianceManager._id,
    assignedBy: entityAdmin._id,
    dueDate: new Date('2026-01-31'),
    priority: 'high',
    status: 'open',
    isAutoGenerated: true,
    autoGenSource: 'renewal_job',
    createdBy: entityAdmin._id,
  });
  log(`Task: "${task1.title}" → ${task1.status}`);

  const task2 = await Task.create({
    title: 'Upload Fire NOC Certificate for Mumbai Unit 1',
    description: 'Fire NOC expires June 30. Upload renewed certificate.',
    taskType: 'document_upload',
    entity: entity._id,
    location: location1._id,
    complianceRecord: record2._id,
    assignedTo: complianceManager._id,
    assignedBy: entityAdmin._id,
    dueDate: new Date('2026-05-31'),
    priority: 'medium',
    status: 'open',
    isAutoGenerated: false,
    createdBy: entityAdmin._id,
  });
  log(`Task: "${task2.title}" → ${task2.status}`);

  // ── 16. Notifications ─────────────────────────────────────────────────────
  section('16. Notifications');

  await Notification.create({
    recipient: complianceManager._id,
    type: 'task_assigned',
    title: 'New Task Assigned: Renew FSSAI Licence',
    body: 'You have been assigned to renew FSSAI Licence for Mumbai Unit 1 before Jan 31, 2026.',
    relatedTask: task1._id,
    channels: [
      { channel: 'in_app', status: 'delivered', deliveredAt: new Date() },
      { channel: 'email', status: 'sent', sentAt: new Date() },
    ],
    isRead: false,
    entity: entity._id,
  });
  log(`Notification → ${complianceManager.email}: task_assigned`);

  await Notification.create({
    recipient: complianceManager._id,
    type: 'compliance_expired',
    title: 'Compliance Expired: FSSAI-ANNUAL for Pune Clinic 1',
    body: 'The annual FSSAI compliance record for Pune Clinic 1 expired on Dec 31, 2025. Immediate action required.',
    relatedComplianceRecord: record3._id,
    channels: [
      { channel: 'in_app', status: 'delivered', deliveredAt: new Date() },
      { channel: 'email', status: 'sent', sentAt: new Date() },
    ],
    isRead: false,
    entity: entity._id,
  });
  log(`Notification → ${complianceManager.email}: compliance_expired`);

  // ── 17. Audit Logs ────────────────────────────────────────────────────────
  section('17. Audit Logs');

  await AuditLog.create({
    action: 'create',
    resource: 'Entity',
    resourceId: entity._id,
    entity: entity._id,
    actor: superAdmin._id,
    actorEmail: superAdmin.email,
    actorRole: superAdminRole.name,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (DevSeedScript)',
    newValue: { code: entity.code, name: entity.name },
    description: `Entity ${entity.code} created`,
  });

  await AuditLog.create({
    action: 'create',
    resource: 'Location',
    resourceId: location1._id,
    entity: entity._id,
    actor: entityAdmin._id,
    actorEmail: entityAdmin.email,
    actorRole: adminRole.name,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (DevSeedScript)',
    newValue: { code: location1.code, name: location1.name },
    description: `Location ${location1.code} created`,
  });

  await AuditLog.create({
    action: 'approve',
    resource: 'ComplianceRecord',
    resourceId: record1._id,
    entity: entity._id,
    actor: complianceManager._id,
    actorEmail: complianceManager.email,
    actorRole: managerRole.name,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (DevSeedScript)',
    previousValue: { status: 'pending' },
    newValue: { status: 'approved' },
    description: `Compliance record ${record1.recordNumber} approved at level 1`,
  });
  log('3 audit log entries created');

  // ── 18. Settings ──────────────────────────────────────────────────────────
  section('18. Settings');

  await Settings.create({
    entity: null,
    notifications: {
      emailEnabled: true,
      whatsappEnabled: false,
      smsEnabled: false,
      defaultReminderDays: [90, 60, 30, 7],
    },
    workflows: [
      {
        name: 'Compliance Sign-off',
        code: 'COMPLIANCE_SIGN_OFF',
        steps: [
          { step: 1, name: 'Manager Review', role: managerRole._id, isRequired: true, canDelegate: false, slaHours: 48 },
          { step: 2, name: 'Admin Approval', role: adminRole._id, isRequired: true, canDelegate: true, slaHours: 72 },
        ],
        isActive: true,
      },
    ],
    config: {
      sessionTimeoutMinutes: 60,
      maxFileUploadSizeMB: 25,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    },
    updatedBy: superAdmin._id,
  });
  log('Global settings created');

  await Settings.create({
    entity: entity._id,
    notifications: {
      emailEnabled: true,
      whatsappEnabled: true,
      smsEnabled: false,
      defaultReminderDays: [60, 30, 7],
    },
    workflows: [],
    config: { entityTimezone: 'Asia/Kolkata' },
    updatedBy: entityAdmin._id,
  });
  log(`Entity settings created for ${entity.code}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  section('✅ SEED COMPLETE — All 19 Models Summary');

  const modelsList = [
    { name: 'Permission', model: Permission },
    { name: 'Role', model: Role },
    { name: 'User', model: User },
    { name: 'MasterData', model: MasterData },
    { name: 'EntityType', model: EntityType },
    { name: 'LocationType', model: LocationType },
    { name: 'Entity', model: Entity },
    { name: 'Location', model: Location },
    { name: 'ComplianceRule', model: ComplianceRule },
    { name: 'ComplianceRecord', model: ComplianceRecord },
    { name: 'Licence', model: Licence },
    { name: 'Document', model: CmsDocument },
    { name: 'DocumentVersion', model: DocumentVersion },
    { name: 'Workflow', model: Workflow },
    { name: 'Approval', model: Approval },
    { name: 'Task', model: Task },
    { name: 'Notification', model: Notification },
    { name: 'AuditLog', model: AuditLog },
    { name: 'Settings', model: Settings },
  ];

  const counts = await Promise.all(modelsList.map(m => m.model.countDocuments()));

  console.log('\n  Collection counts:');
  modelsList.forEach((m, i) => console.log(`    ${m.name.padEnd(20)} ${counts[i]}`));
  console.log(`\n  Total documents: ${counts.reduce((a, b) => a + b, 0)}`);

  await mongoose.disconnect();
  console.log('\n✅ MongoDB disconnected. Seed complete.\n');
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
