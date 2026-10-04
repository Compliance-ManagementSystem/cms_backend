/**
 * Location Master Import
 *
 * Loads the "Active" sheet of the Location Master workbook into the database:
 *   - one Location per row (owner entity, co-entity, type, address, area type, status)
 *   - one ComplianceRule per licence column
 *   - one ComplianceRecord per filled licence cell
 *
 * Usage (from server/):
 *   npm run import:locations -- --dry-run          parse and report, write nothing
 *   npm run import:locations                       import
 *   npm run import:locations -- --file=<path.xlsx> use another workbook
 *
 * Safe to re-run: locations are matched on (entity, code) and refreshed from the
 * sheet; compliance records are only created when missing, never overwritten.
 */

import path from 'node:path';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { Entity, Location, MasterData, ComplianceRule, ComplianceRecord } from '../models/index.js';
import type { ComplianceRecordStatus } from '../models/ComplianceRecord.js';

const SHEET_NAME = 'Active';
const FIRST_DATA_ROW = 4;
const DEFAULT_FILE = '../Location Master_010926(1).xlsx';
const SOURCE_TAG = 'Location Master (Active sheet)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FILE = path.resolve(args.find((a) => a.startsWith('--file='))?.slice(7) || DEFAULT_FILE);

type Company = 'CCPL' | 'CPPL' | 'CTPL';

// ── Sheet layout ───────────────────────────────────────────────────────────────

const COL = {
  slNo: 1,
  code: 2,
  name: 3,
  openingCcpl: 4,
  openingCppl: 5,
  type: 6,
  address: 7,
  district: 8,
  state: 9,
  areaType: 10,
  fssaiRegdNo: 22,
  status: 25,
} as const;

interface RuleColumn {
  col: number;
  code: string;
  name: string;
  category: string; // MasterData compliance_category code
  company?: Company; // The company the sheet tracks this licence for
}

const RULE_COLUMNS: RuleColumn[] = [
  { col: 11, code: 'FIRE-NOC', name: 'Fire NOC / Fire Affidavit', category: 'FIRE_SAFETY' },
  { col: 12, code: 'OCCUPANCY-CERT', name: 'Occupancy Certificate', category: 'LOCAL_BODY' },
  { col: 13, code: 'CE-CERT-CCPL', name: 'Clinical Establishment Certificate (CCPL)', category: 'CLINICAL_EST', company: 'CCPL' },
  { col: 14, code: 'BMW-PC-CCPL', name: 'Bio-Medical Waste Pollution Consent (CCPL)', category: 'ENVIRONMENTAL', company: 'CCPL' },
  { col: 15, code: 'DRUG-LICENCE-CPPL', name: 'Drug Licence (CPPL)', category: 'PHARMACY', company: 'CPPL' },
  { col: 16, code: 'TRADE-LICENCE-CCPL', name: 'Trade Licence & NOC (CCPL)', category: 'LOCAL_BODY', company: 'CCPL' },
  { col: 17, code: 'TRADE-LICENCE-CPPL', name: 'Trade Licence & NOC (CPPL)', category: 'LOCAL_BODY', company: 'CPPL' },
  { col: 18, code: 'SHOP-ESTAB-CCPL', name: 'Shop & Establishment (CCPL)', category: 'LABOUR', company: 'CCPL' },
  { col: 19, code: 'SHOP-ESTAB-CPPL', name: 'Shop & Establishment (CPPL)', category: 'LABOUR', company: 'CPPL' },
  { col: 20, code: 'GP-NOC', name: 'Gram Panchayat NOC', category: 'LOCAL_BODY' },
  { col: 21, code: 'FSSAI-CPPL', name: 'FSSAI Licence (CPPL)', category: 'FOOD_SAFETY', company: 'CPPL' },
  { col: 23, code: 'GST-APOB-CCPL', name: 'GST Additional Place of Business (CCPL)', category: 'TAX', company: 'CCPL' },
  { col: 24, code: 'GST-APOB-CPPL', name: 'GST Additional Place of Business (CPPL)', category: 'TAX', company: 'CPPL' },
];

const NEW_CATEGORIES = [
  { code: 'CLINICAL_EST', label: 'Clinical Establishment', description: 'Clinical Establishment Act registration' },
  { code: 'LOCAL_BODY', label: 'Local Body & Municipal', description: 'Trade licence, panchayat NOC and occupancy certificate' },
];

const LOCATION_TYPES: Record<string, { code: string; label: string }> = {
  O: { code: 'OFFICE', label: 'Corporate Office' },
  C: { code: 'CLINIC', label: 'Outpatient Clinic' },
  WH: { code: 'WAREHOUSE', label: 'Central Distribution Warehouse' },
  P: { code: 'PHARMACY', label: 'Pharmacy' },
  'C+P': { code: 'CLINIC_PHARMACY', label: 'Clinic with Pharmacy' },
  'P+WH': { code: 'PHARMACY_WAREHOUSE', label: 'Pharmacy with Warehouse' },
  'C+P+WH': { code: 'CLINIC_PHARMACY_WAREHOUSE', label: 'Clinic with Pharmacy and Warehouse' },
};

const STATES: Record<string, { code: string; label: string }> = {
  ODISHA: { code: 'OD', label: 'Odisha' },
  CHHATTISGARH: { code: 'CG', label: 'Chhattisgarh' },
  JHARKHAND: { code: 'JH', label: 'Jharkhand' },
  KARNATAKA: { code: 'KA', label: 'Karnataka' },
  BIHAR: { code: 'BR', label: 'Bihar' },
  TELANGANA: { code: 'TS', label: 'Telangana' },
  AP: { code: 'AP', label: 'Andhra Pradesh' },
  MP: { code: 'MP', label: 'Madhya Pradesh' },
  UP: { code: 'UP', label: 'Uttar Pradesh' },
};

// How each sheet value maps onto a compliance record
const STATUS_MAP: Record<string, { status: ComplianceRecordStatus; notApplicable?: boolean }> = {
  APPROVED: { status: 'approved' },
  ADDED: { status: 'approved' },
  'FIRE AFFIDAVIT': { status: 'approved' },
  'FIRE NOC': { status: 'approved' },
  APPLIED: { status: 'in_progress' },
  TBA: { status: 'pending' },
  'NOT APPLICABLE': { status: 'not_applicable', notApplicable: true },
  NA: { status: 'not_applicable', notApplicable: true },
  NR: { status: 'not_applicable', notApplicable: true },
  'NOT REQUIRED': { status: 'not_applicable', notApplicable: true },
  'NO PHARMACY': { status: 'not_applicable', notApplicable: true },
  // Applied for, then the unit closed
  'APPLIED-INACTIVE': { status: 'not_applicable', notApplicable: true },
};
const BLANK_VALUES = new Set(['', '-', '_']);

// ── Cell helpers ───────────────────────────────────────────────────────────────

const cellValue = (cell: ExcelJS.Cell): string | number | Date | null => {
  let v: any = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((t: { text: string }) => t.text).join('');
    else if ('text' in v) v = v.text;
    else if ('error' in v) v = null;
  }
  return v ?? null;
};

const text = (cell: ExcelJS.Cell): string => {
  const v = cellValue(cell);
  if (v === null || v instanceof Date) return '';
  return String(v).replace(/\s+/g, ' ').trim();
};

/** Real dates, or text such as 25.09.2025 / 25-03-2026 / 17/04/2026 (day first) */
const parseDate = (cell: ExcelJS.Cell): Date | undefined => {
  const v = cellValue(cell);
  if (v instanceof Date) return v;
  const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
};

const titleCase = (value: string) =>
  value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());

const slug = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "E CLINIC DURG", "ECLINIC_CHAPLE", "ECLINIC - KURU" → "ECLINIC-…"; the six OFFICE rows get their name */
const toLocationCode = (sheetCode: string, name: string): string => {
  const upper = sheetCode.toUpperCase().trim();
  if (upper === 'OFFICE') {
    return `OFFICE-${slug(name.replace(/\boffice\b/gi, ''))}`;
  }
  return slug(upper.replace(/^E\s*CLINIC[\s_-]*/, 'ECLINIC-'));
};

// ── Parsing ────────────────────────────────────────────────────────────────────

interface ParsedRecord {
  rule: RuleColumn;
  sheetValue: string;
  status: ComplianceRecordStatus;
  notApplicable: boolean;
  entity: Company;
  notes: string;
  licenceNumber?: string;
}

interface ParsedLocation {
  row: number;
  slNo: string;
  sheetCode: string;
  code: string;
  name: string;
  entity: Company;
  coEntity?: { entity: Company; openingDate?: Date };
  typeKey: string;
  openingDate?: Date;
  address: { line1: string; district: string; state: string; pincode?: string };
  areaType?: 'GP' | 'NAC' | 'MUN';
  status: 'active' | 'inactive';
  records: ParsedRecord[];
}

interface ParseResult {
  locations: ParsedLocation[];
  problems: string[];
  skippedCells: Map<string, number>; // "<rule code>: <value>" → count
  blankCells: number;
}

const ownerOf = (typeKey: string, name: string, gstCcpl: string): Company => {
  if (typeKey === 'O') {
    const named = name.toUpperCase().match(/\b(CTPL|CCPL|CPPL)\b/);
    if (named) return named[1] as Company;
    return gstCcpl.toUpperCase() === 'CTPL' ? 'CTPL' : 'CCPL';
  }
  return typeKey.split('+').includes('C') ? 'CCPL' : 'CPPL';
};

const parseSheet = (sheet: ExcelJS.Worksheet): ParseResult => {
  const result: ParseResult = { locations: [], problems: [], skippedCells: new Map(), blankCells: 0 };

  for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const sheetCode = text(row.getCell(COL.code));
    const name = text(row.getCell(COL.name));
    if (!sheetCode && !name) continue;

    const where = `Row ${r} (${sheetCode || name})`;
    const typeKey = text(row.getCell(COL.type)).toUpperCase().replace(/\s+/g, '');
    const stateKey = text(row.getCell(COL.state)).toUpperCase();
    const statusText = text(row.getCell(COL.status)).toUpperCase();
    const line1 = text(row.getCell(COL.address));

    if (!LOCATION_TYPES[typeKey]) result.problems.push(`${where}: unknown type "${typeKey}"`);
    if (!STATES[stateKey]) result.problems.push(`${where}: unknown state "${stateKey}"`);
    if (statusText !== 'ACTIVE' && statusText !== 'INACTIVE') result.problems.push(`${where}: unknown status "${statusText}"`);
    if (!line1) result.problems.push(`${where}: no address`);
    if (!LOCATION_TYPES[typeKey] || !STATES[stateKey] || !line1) continue;

    const owner = ownerOf(typeKey, name, text(row.getCell(23)));
    const parts = typeKey.split('+');
    const openingCcpl = parseDate(row.getCell(COL.openingCcpl));
    const openingCppl = parseDate(row.getCell(COL.openingCppl));

    // A pharmacy or warehouse inside a clinic is run by CPPL
    const coEntity =
      owner === 'CCPL' && parts.includes('C') && (parts.includes('P') || parts.includes('WH'))
        ? { entity: 'CPPL' as Company, openingDate: openingCppl }
        : undefined;
    const companies = new Set<Company>([owner, ...(coEntity ? [coEntity.entity] : [])]);

    const areaText = text(row.getCell(COL.areaType)).toUpperCase();
    const areaType = areaText.startsWith('MUN') ? 'MUN' : areaText === 'GP' || areaText === 'NAC' ? areaText : undefined;
    if (areaText && !areaType) result.problems.push(`${where}: unknown area type "${areaText}"`);

    const pincodes = line1.match(/(?<!\d)[1-9]\d{5}(?!\d)/g);
    const fssaiRegdNo = text(row.getCell(COL.fssaiRegdNo));

    const records: ParsedRecord[] = [];
    for (const rule of RULE_COLUMNS) {
      const sheetValue = text(row.getCell(rule.col));
      const key = sheetValue.toUpperCase();
      if (BLANK_VALUES.has(key)) {
        result.blankCells++;
        continue;
      }
      const mapped = STATUS_MAP[key];
      if (!mapped) {
        const label = `${rule.code}: "${sheetValue}"`;
        result.skippedCells.set(label, (result.skippedCells.get(label) || 0) + 1);
        continue;
      }
      const licenceNumber =
        rule.code === 'FSSAI-CPPL' && /\d{10,}/.test(fssaiRegdNo) ? fssaiRegdNo : undefined;
      records.push({
        rule,
        sheetValue,
        status: mapped.status,
        notApplicable: !!mapped.notApplicable,
        entity: rule.company && companies.has(rule.company) ? rule.company : owner,
        notes: `Sheet status: ${sheetValue}`,
        licenceNumber,
      });
    }

    result.locations.push({
      row: r,
      slNo: text(row.getCell(COL.slNo)),
      sheetCode,
      code: toLocationCode(sheetCode, name),
      name,
      entity: owner,
      coEntity,
      typeKey,
      openingDate: owner === 'CPPL' ? openingCppl || openingCcpl : openingCcpl,
      address: {
        line1,
        district: titleCase(text(row.getCell(COL.district))),
        state: STATES[stateKey].label,
        pincode: pincodes ? pincodes[pincodes.length - 1] : undefined,
      },
      areaType: areaType as ParsedLocation['areaType'],
      status: statusText === 'INACTIVE' ? 'inactive' : 'active',
      records,
    });
  }

  // Codes must be unique within the owning entity
  const seen = new Map<string, number>();
  for (const loc of result.locations) {
    const key = `${loc.entity}/${loc.code}`;
    if (seen.has(key)) result.problems.push(`Row ${loc.row}: code ${key} repeats row ${seen.get(key)}`);
    seen.set(key, loc.row);
  }

  return result;
};

const count = <T,>(items: T[], keyOf: (item: T) => string) => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] || 0) + 1;
  return counts;
};

const report = (parsed: ParseResult) => {
  const { locations } = parsed;
  const records = locations.flatMap((l) => l.records);
  console.log(`\nLocations parsed: ${locations.length}`);
  console.log('  by owner      ', count(locations, (l) => l.entity));
  console.log('  by type       ', count(locations, (l) => LOCATION_TYPES[l.typeKey].code));
  console.log('  by state      ', count(locations, (l) => l.address.state));
  console.log('  by area type  ', count(locations, (l) => l.areaType || '(none)'));
  console.log('  by status     ', count(locations, (l) => l.status));
  console.log(`  with co-entity: ${locations.filter((l) => l.coEntity).length}`);
  console.log(`  no opening date: ${locations.filter((l) => !l.openingDate).length}`);
  console.log(`  no pincode in address: ${locations.filter((l) => !l.address.pincode).length}`);
  console.log(`\nCompliance records parsed: ${records.length}`);
  console.log('  by status     ', count(records, (r) => r.status));
  console.log(`  blank cells skipped: ${parsed.blankCells}`);
  if (parsed.skippedCells.size > 0) {
    console.log('  unrecognised values skipped:');
    for (const [label, n] of parsed.skippedCells) console.log(`    ${label} × ${n}`);
  }
  if (parsed.problems.length > 0) {
    console.log(`\nProblems (${parsed.problems.length}):`);
    parsed.problems.forEach((p) => console.log(`  - ${p}`));
  }
};

// ── Database writes ────────────────────────────────────────────────────────────

const upsertMasterData = async (category: string, code: string, label: string, description = '') => {
  const existing = await MasterData.findOne({ category, code });
  if (existing) return existing;
  return MasterData.create({ category, code, label, description, status: 'active' });
};

const ensureEntity = async (code: Company): Promise<Types.ObjectId> => {
  const existing = await Entity.findOne({ code }).select('_id');
  if (existing) return existing._id;

  const entityType = await MasterData.findOne({ category: 'entity_type', code });
  if (!entityType) throw new Error(`Entity type "${code}" is missing from Master Data`);

  // Registered office address as given in the sheet. Contact details are not in
  // the sheet and must be filled in from the Entities screen.
  const created = await Entity.create({
    name: code,
    code,
    entityType: entityType._id,
    address: {
      line1: 'Plot No. A-98, Budha Nagar, Laxmi Sagar',
      city: 'Bhubaneswar',
      district: 'Khordha',
      state: 'Odisha',
      pincode: '751006',
      country: 'India',
    },
    contactEmail: 'not-provided@example.invalid',
    contactPhone: 'Not provided',
    description: `Created by the ${SOURCE_TAG} import. Name and contact details need completing.`,
    status: 'active',
  });
  console.log(`  created entity ${code} (placeholder name and contact details)`);
  return created._id;
};

const importToDatabase = async (parsed: ParseResult) => {
  await connectDB();

  // Reference data
  const entityIds = {} as Record<Company, Types.ObjectId>;
  for (const code of new Set(parsed.locations.flatMap((l) => [l.entity, ...(l.coEntity ? [l.coEntity.entity] : [])]))) {
    entityIds[code] = await ensureEntity(code);
  }

  const typeIds: Record<string, Types.ObjectId> = {};
  for (const [key, type] of Object.entries(LOCATION_TYPES)) {
    typeIds[key] = (await upsertMasterData('location_type', type.code, type.label))._id;
  }
  for (const state of Object.values(STATES)) {
    const taken = await MasterData.findOne({ category: 'state', label: state.label });
    if (!taken) await upsertMasterData('state', state.code, state.label);
  }
  for (const category of NEW_CATEGORIES) {
    await upsertMasterData('compliance_category', category.code, category.label, category.description);
  }

  const frequency = await MasterData.findOne({ category: 'compliance_frequency', code: 'ANNUALLY' });
  if (!frequency) throw new Error('Compliance frequency "ANNUALLY" is missing from Master Data');

  const ruleIds: Record<string, Types.ObjectId> = {};
  let rulesCreated = 0;
  for (const rule of RULE_COLUMNS) {
    let doc = await ComplianceRule.findOne({ code: rule.code }).select('_id');
    if (!doc) {
      const category = await MasterData.findOne({ category: 'compliance_category', code: rule.category });
      if (!category) throw new Error(`Compliance category "${rule.category}" is missing from Master Data`);
      doc = await ComplianceRule.create({
        name: rule.name,
        code: rule.code,
        description: `Created by the ${SOURCE_TAG} import. Renewal frequency is a default and needs confirming.`,
        category: category._id,
        frequency: frequency._id,
      });
      rulesCreated++;
    }
    ruleIds[rule.code] = doc._id;
  }

  // Locations and their records
  const stats = { locationsCreated: 0, locationsUpdated: 0, recordsCreated: 0, recordsKept: 0 };
  const year = new Date().getFullYear();
  let sequence = await ComplianceRecord.countDocuments();
  const createdRecordIds: Types.ObjectId[] = [];

  for (const loc of parsed.locations) {
    const entity = entityIds[loc.entity];
    let doc = await Location.findOne({ entity, code: loc.code });
    if (doc) stats.locationsUpdated++;
    else {
      doc = new Location({ entity, code: loc.code });
      stats.locationsCreated++;
    }

    doc.set({
      name: loc.name,
      locationType: typeIds[loc.typeKey],
      coEntities: loc.coEntity ? [{ entity: entityIds[loc.coEntity.entity], openingDate: loc.coEntity.openingDate }] : [],
      address: { ...loc.address, country: 'India' },
      openingDate: loc.openingDate,
      areaType: loc.areaType,
      status: loc.status,
      description: `Imported from ${SOURCE_TAG}, Sl. No. ${loc.slNo || '—'}, sheet code "${loc.sheetCode}".`,
    });
    await doc.save();

    const existingRules = new Set(
      (await ComplianceRecord.find({ location: doc._id }).select('rule').lean()).map((rec) => String(rec.rule))
    );
    for (const rec of loc.records) {
      const rule = ruleIds[rec.rule.code];
      if (existingRules.has(String(rule))) {
        stats.recordsKept++;
        continue;
      }
      sequence++;
      const created = await ComplianceRecord.create({
        entity: entityIds[rec.entity],
        location: doc._id,
        rule,
        recordNumber: `CR-${year}-${String(sequence).padStart(4, '0')}-${Math.floor(1000 + Math.random() * 9000)}`,
        status: rec.status,
        isApplicable: !rec.notApplicable,
        notApplicableReason: rec.notApplicable ? `Sheet status: ${rec.sheetValue}` : undefined,
        notes: rec.notes,
        licenceNumber: rec.licenceNumber,
        internalNotes: `Imported from ${SOURCE_TAG}.`,
      });
      createdRecordIds.push(created._id);
      stats.recordsCreated++;
    }
  }

  // The model stamps "approved today" on save; the sheet has no approval dates
  await ComplianceRecord.updateMany({ _id: { $in: createdRecordIds } }, { $unset: { approvalDate: 1 } });

  console.log(`\nRules created: ${rulesCreated} (of ${RULE_COLUMNS.length})`);
  console.log(`Locations created: ${stats.locationsCreated}, updated: ${stats.locationsUpdated}`);
  console.log(`Compliance records created: ${stats.recordsCreated}, already present (left untouched): ${stats.recordsKept}`);

  await disconnectDB();
};

// ── Main ───────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`Reading ${FILE}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in the workbook`);

  const parsed = parseSheet(sheet);
  report(parsed);

  if (DRY_RUN) {
    console.log('\nDry run: nothing was written.');
    return;
  }
  if (parsed.problems.length > 0) {
    throw new Error('Fix the problems above (or the sheet) before importing. Nothing was written.');
  }
  await importToDatabase(parsed);
};

main().catch((error) => {
  console.error(`\n❌ Import failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
