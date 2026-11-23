// Converting LeetCode profile scrapes to stored snapshots and back (shared by the worker and the
// web app, so both store and read exactly the same shape).
import { agoToSeconds, parseLeetcodeProfile } from './leetcode.js';
import type { LeetcodeSnapshotRecord } from './leetcode-day.js';
import type { ProfileScrape } from './leetcode-fetch.js';

export interface SnapshotRow {
  profile_id: string;
  handle: string;
  source: 'join' | 'scheduled' | 'manual';
  readable: boolean;
  solved: number | null;
  easy: number | null;
  medium: number | null;
  hard: number | null;
  has_history: boolean;
  recent: { id: string; title: string; ago: string }[];
  error: string | null;
  observed_at?: string;
}

/** A scrape becomes a row; a page that isn't this user's profile is stored as unreadable. */
export function snapshotRowFromScrape(scrape: ProfileScrape, profileId: string, handle: string, source: SnapshotRow['source']): SnapshotRow {
  const lower = handle.toLowerCase();
  const base = { profile_id: profileId, handle: lower, source, solved: null, easy: null, medium: null, hard: null, has_history: false, recent: [] as SnapshotRow['recent'] };
  if (!scrape.ok || scrape.pageStatus !== 200) {
    return { ...base, readable: false, error: (scrape.error ?? `page status ${scrape.pageStatus ?? 'unknown'}`).slice(0, 300) };
  }
  if ((scrape.title ?? '').trim().toLowerCase() !== `${lower} - leetcode profile`) {
    return { ...base, readable: false, error: 'the page is not this user’s LeetCode profile' };
  }
  const p = parseLeetcodeProfile(scrape.markdown);
  return {
    ...base,
    readable: true,
    solved: p.solved,
    easy: p.easy ?? null,
    medium: p.medium ?? null,
    hard: p.hard ?? null,
    has_history: p.hasRecentAcSection,
    recent: p.recentAccepted.slice(0, 40).map((r) => ({ id: r.submissionId, title: r.title.slice(0, 200), ago: r.ago })),
    error: null,
  };
}

/** A stored row becomes the engine's input. */
export function snapshotRecordFromRow(row: Omit<SnapshotRow, 'profile_id' | 'source'> & { observed_at: string }): LeetcodeSnapshotRecord {
  if (!row.readable) return { observedAt: row.observed_at, readable: false, snapshot: null };
  return {
    observedAt: row.observed_at,
    readable: true,
    snapshot: {
      solved: row.solved,
      totalProblems: null,
      easy: row.easy,
      medium: row.medium,
      hard: row.hard,
      hasRecentAcSection: row.has_history,
      recentAccepted: (row.recent ?? []).map((r) => ({ submissionId: r.id, title: r.title, ago: r.ago, approxAgeSeconds: agoToSeconds(r.ago) })),
    },
  };
}
