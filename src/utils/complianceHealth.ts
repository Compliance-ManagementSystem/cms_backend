/**
 * Compliance Health
 *
 * One definition of how a compliance record counts towards health figures,
 * shared by the dashboard and the location views.
 */

/**
 * Every compliance record falls into exactly one health bucket:
 *   - compliant    : approved and valid beyond the expiring-soon window
 *   - expiringSoon : approved and valid, but expires within EXPIRING_SOON_DAYS
 *   - pending      : somewhere in the workflow (not yet approved, rejected, in correction)
 *   - expired      : validity has lapsed
 */
export type HealthBucket = 'compliant' | 'expiringSoon' | 'pending' | 'expired';

export const EXPIRING_SOON_DAYS = 30;

export interface HealthCounts {
  total: number;
  compliant: number;
  expiringSoon: number;
  pending: number;
  expired: number;
  /** Share of records that are currently valid (compliant + expiring soon) */
  percentage: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const classifyRecord = (
  record: { status: string; expiryDate?: Date | null },
  now: Date
): HealthBucket => {
  if (record.status === 'expired') return 'expired';

  if (record.status === 'approved' || record.status === 'expiring_soon') {
    const expiry = record.expiryDate ? new Date(record.expiryDate) : null;
    if (expiry && expiry < now) return 'expired'; // lapsed, nightly job has not flipped it yet
    if (expiry && expiry.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) return 'expiringSoon';
    return 'compliant';
  }

  return 'pending';
};

export const emptyCounts = (): Omit<HealthCounts, 'percentage'> => ({
  total: 0,
  compliant: 0,
  expiringSoon: 0,
  pending: 0,
  expired: 0,
});

export const withPercentage = (counts: Omit<HealthCounts, 'percentage'>): HealthCounts => ({
  ...counts,
  percentage:
    counts.total > 0 ? Math.round(((counts.compliant + counts.expiringSoon) / counts.total) * 100) : 0,
});

/** Health counts for a set of records */
export const summariseHealth = (
  records: Array<{ status: string; expiryDate?: Date | null }>,
  now: Date = new Date()
): HealthCounts => {
  const counts = emptyCounts();
  for (const record of records) {
    counts.total++;
    counts[classifyRecord(record, now)]++;
  }
  return withPercentage(counts);
};

/** Mongo condition matching records that count as expired (see classifyRecord) */
export const expiredRecordCondition = (now: Date = new Date()) => ({
  $or: [
    { status: 'expired' },
    { status: { $in: ['approved', 'expiring_soon'] }, expiryDate: { $lt: now } },
  ],
});
