/**
 * One-time setup for soft-deleted compliance records, run on every start (idempotent):
 *   - records saved before soft delete existed get isDeleted: false, so the
 *     partial unique index below covers them
 *   - the old unique (location, rule) index, which also counted deleted records,
 *     is replaced by one that only covers live records
 */

import ComplianceRecord, { LOCATION_RULE_INDEX } from '../models/ComplianceRecord.js';

export const prepareComplianceRecordSoftDelete = async (): Promise<void> => {
  await ComplianceRecord.collection.updateMany({ isDeleted: { $exists: false } }, { $set: { isDeleted: false } });

  const indexes = await ComplianceRecord.collection.indexes();
  const legacy = indexes.find(
    (index) =>
      index.name !== LOCATION_RULE_INDEX &&
      index.unique &&
      !index.partialFilterExpression &&
      index.key.location === 1 &&
      index.key.rule === 1 &&
      Object.keys(index.key).length === 2
  );
  if (legacy?.name) {
    await ComplianceRecord.collection.dropIndex(legacy.name);
    console.log(`Replaced compliance record index ${legacy.name} with ${LOCATION_RULE_INDEX}`);
  }

  await ComplianceRecord.createIndexes();
};
