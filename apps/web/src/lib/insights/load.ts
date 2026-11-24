import 'server-only';

import { computeInsights, type InsightDay, type InsightEvidence, type Insights } from '@codestreak/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The viewer's insights from their own records only (RLS): day results recorded on-chain, Shields,
 * and evidence that counted. Preview checks ("Check now") are not counted.
 */
export async function loadInsights(supabase: SupabaseClient, profileId: string, nowSecs: number): Promise<{ insights: Insights; challenges: number }> {
  const { data: members } = await supabase.from('memberships').select('id, challenges!inner(start_at, day_length_secs)').eq('profile_id', profileId);
  const byId = new Map<string, { start: number; len: number }>();
  for (const m of members ?? []) {
    const c = (Array.isArray(m.challenges) ? m.challenges[0] : m.challenges) as { start_at: string; day_length_secs: number };
    byId.set(m.id as string, { start: Math.floor(Date.parse(c.start_at) / 1000), len: c.day_length_secs });
  }
  const ids = [...byId.keys()];
  if (!ids.length) return { insights: computeInsights([], [], nowSecs), challenges: 0 };
  const [{ data: results }, { data: shields }, { data: evidence }] = await Promise.all([
    supabase.from('day_results').select('membership_id, day, result').in('membership_id', ids).not('onchain_at', 'is', null).limit(5000),
    supabase.from('shields').select('membership_id, day').in('membership_id', ids).limit(5000),
    supabase.from('evidence').select('membership_id, day, provider').in('membership_id', ids).eq('counted', true).limit(10000),
  ]);
  const shielded = new Set((shields ?? []).map((s) => `${s.membership_id}:${s.day}`));
  const at = (membership: string, day: number) => {
    const c = byId.get(membership)!;
    return c.start + day * c.len;
  };
  const days: InsightDay[] = (results ?? []).map((r) => ({
    challenge: r.membership_id as string,
    startedAt: at(r.membership_id as string, r.day as number),
    result: r.result as InsightDay['result'],
    shielded: shielded.has(`${r.membership_id}:${r.day}`),
  }));
  const ev: InsightEvidence[] = (evidence ?? []).map((e) => ({ at: at(e.membership_id as string, e.day as number), provider: e.provider as InsightEvidence['provider'] }));
  return { insights: computeInsights(days, ev, nowSecs), challenges: new Set(days.map((d) => d.challenge)).size };
}

/** Server time for the page (kept out of render functions). */
export const nowSecs = () => Math.floor(Date.now() / 1000);
