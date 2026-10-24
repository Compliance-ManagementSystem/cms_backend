/**
 * Fills `searchTokens` on documents saved before indexed search existed, run on
 * every start (idempotent — only documents without tokens are touched).
 * Pass `{ all: true }` to rebuild every document after changing searched fields.
 */

import type { Model } from 'mongoose';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { refreshSearchTokens } from './search.js';

const SEARCHABLE_MODELS: Model<any>[] = [Entity, Location, ComplianceRecord, Task, User];

export const backfillSearchTokens = async ({ all = false } = {}): Promise<void> => {
  for (const model of SEARCHABLE_MODELS) {
    const updated = await refreshSearchTokens(model, all ? {} : { searchTokens: { $exists: false } });
    if (updated) console.log(`Search tokens: indexed ${updated} ${model.modelName} document(s)`);
  }
};
