/**
 * Indexed prefix search.
 *
 * Case-insensitive "contains" regexes (/term/i) cannot use an index, so every
 * search scanned the whole collection. Instead, each searchable model stores
 * `searchTokens`: the lowercase words of its searchable fields, in a multikey
 * index. A query matches when every typed word is the start of some token, and
 * an anchored, case-sensitive regex (/^term/) is answered from the index.
 *
 *   "Mumbai Petrol Pump" → ["mumbai", "petrol", "pump", "mumbaipetrolpump"]
 *   search "petr pu"     → { $and: [{ searchTokens: /^petr/ }, { searchTokens: /^pu/ }] }
 *
 * Tokens are refreshed in pre('validate'), which runs on create(), save() and
 * insertMany(). A query update (updateOne, findByIdAndUpdate, …) that changes a
 * searched field bypasses it — call `refreshSearchTokens` afterwards.
 */

import type { Model, Schema, FilterQuery } from 'mongoose';

const MAX_TOKENS = 200;
const MAX_TOKEN_LENGTH = 40;
const MAX_QUERY_WORDS = 6;
const MAX_JOINED_PARTS = 5;

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalize = (value: string): string =>
  value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const words = (value: string): string[] => normalize(value).split(/[^a-z0-9]+/).filter(Boolean);

/** Search tokens for a set of field values. */
export const buildSearchTokens = (values: unknown[]): string[] => {
  const tokens = new Set<string>();
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parts = words(String(value));
    parts.forEach((w) => tokens.add(w.slice(0, MAX_TOKEN_LENGTH)));
    // Short values also without separators, from each word on, so "cr20260001"
    // finds "CR-2026-0001-1234" and "9876543210" finds "+91 98765 43210"
    if (parts.length > 1 && parts.length <= MAX_JOINED_PARTS) {
      for (let i = 0; i < parts.length - 1; i++) {
        tokens.add(parts.slice(i).join('').slice(0, MAX_TOKEN_LENGTH));
      }
    }
    if (tokens.size >= MAX_TOKENS) break;
  }
  return [...tokens].slice(0, MAX_TOKENS);
};

/** The normalized words of a search string, as they are matched against tokens. */
export const searchWords = (search?: string): string[] =>
  [...new Set(words(search ?? ''))].slice(0, MAX_QUERY_WORDS);

/** Matches documents with a token starting with `word` (one normalized search word). */
export const tokenPrefixFilter = (word: string): FilterQuery<any> => ({
  searchTokens: new RegExp(`^${escapeRegex(word)}`),
});

/** Filter matching documents whose tokens start with every word of `search`, or null when nothing searchable was typed. */
export const searchTokenFilter = (search?: string): FilterQuery<any> | null => {
  const clauses = searchWords(search).map(tokenPrefixFilter);
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

const searchFieldsBySchema = new WeakMap<Schema, string[]>();

const tokensFor = (doc: { get: (path: string) => unknown }, fields: string[]) =>
  buildSearchTokens(fields.map((field) => doc.get(field)));

/**
 * Adds an indexed `searchTokens` field built from `fields` (dotted paths allowed).
 * Apply after the schema's own pre('validate') hooks so generated values (e.g.
 * recordNumber) are already set.
 */
export const searchTokensPlugin = (schema: Schema, options: { fields: string[] }) => {
  schema.add({ searchTokens: { type: [String], select: false } });
  schema.index({ searchTokens: 1 });
  schema.pre('validate', function (next) {
    // Only when a searched field changed: a document loaded with a partial
    // projection must not rebuild its tokens from the fields it lacks
    if (this.isNew || options.fields.some((field) => this.isModified(field))) {
      this.set('searchTokens', tokensFor(this, options.fields));
    }
    next();
  });
  searchFieldsBySchema.set(schema, options.fields);
};

const searchFieldsOf = (model: Model<any>): string[] => searchFieldsBySchema.get(model.schema) ?? [];

/** Recompute tokens for documents matching `filter` (after a query update, or as a backfill). */
export const refreshSearchTokens = async (
  model: Model<any>,
  filter: FilterQuery<any> = {}
): Promise<number> => {
  const fields = searchFieldsOf(model);
  if (!fields.length) return 0;

  const cursor = model
    .find(filter)
    .select(fields.join(' '))
    .setOptions({ includeDeleted: true })
    .cursor();

  let ops: any[] = [];
  let updated = 0;
  for await (const doc of cursor) {
    ops.push({
      updateOne: { filter: { _id: doc._id }, update: { $set: { searchTokens: tokensFor(doc, fields) } } },
    });
    if (ops.length === 500) {
      await model.collection.bulkWrite(ops, { ordered: false });
      updated += ops.length;
      ops = [];
    }
  }
  if (ops.length) {
    await model.collection.bulkWrite(ops, { ordered: false });
    updated += ops.length;
  }
  return updated;
};
