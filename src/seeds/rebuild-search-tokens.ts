/**
 * Rebuilds `searchTokens` on every searchable document.
 * Run after changing which fields a model searches: npm run search:reindex
 */

import { connectDB, disconnectDB } from '../config/db.js';
import { backfillSearchTokens } from '../utils/searchTokensBackfill.js';

const main = async () => {
  await connectDB();
  await backfillSearchTokens({ all: true });
  await disconnectDB();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
