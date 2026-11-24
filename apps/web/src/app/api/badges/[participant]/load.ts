import 'server-only';
import { isSolanaAddress } from '@codestreak/shared/wallet';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { BadgeMetadataRow } from '@/lib/badges/metadata';

/** The badge row for a Participant address, or null (not a survivor, unknown, or a bad address). */
export async function loadBadgeMetadata(participant: string): Promise<BadgeMetadataRow | null> {
  if (!isSolanaAddress(participant)) return null;
  const { data, error } = await createSupabaseAdminClient().rpc('badge_metadata', { p_participant: participant });
  if (error) throw new Error(`badge_metadata failed: ${error.message}`);
  return (data as BadgeMetadataRow | null) ?? null;
}
