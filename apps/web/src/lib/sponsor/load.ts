import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SponsorRow {
  wallet: string;
  name: string;
  publicId: string | null;
  total: string;
  contributions: number;
  lastTx: string;
  receipt: string | null;
  message: string | null;
}

/**
 * Sponsor leaderboard, biggest first. `asViewer` reads through the viewer's session (RLS decides
 * whether they may see this challenge's sponsors); the sponsor-link page passes false after
 * checking the link itself.
 */
export async function listSponsors(challengeId: string, asViewer = true): Promise<SponsorRow[]> {
  const client = asViewer ? await createSupabaseServerClient() : createSupabaseAdminClient();
  const { data } = await client
    .from('sponsor_leaderboard')
    .select('sponsor_wallet, public_id, display_name, username, total, contributions, last_tx, receipt_address, last_message')
    .eq('challenge_id', challengeId)
    .order('total', { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => {
    const wallet = r.sponsor_wallet as string;
    return {
      wallet,
      name: (r.display_name as string | null) ?? (r.username as string | null) ?? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      publicId: (r.public_id as string | null) ?? null,
      total: String(r.total),
      contributions: Number(r.contributions),
      lastTx: r.last_tx as string,
      receipt: (r.receipt_address as string | null) ?? null,
      message: (r.last_message as string | null) ?? null,
    };
  });
}
