'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const openSchema = z.object({
  address: z.string().min(32).max(44),
  membershipId: z.uuid(),
  day: z.number().int().min(0).max(59),
  reason: z.string().trim().min(20, 'Explain what happened in at least 20 characters.').max(2000, 'Keep it under 2000 characters.'),
  evidence: z.array(z.string().trim().regex(/^https:\/\/\S{4,}$/, 'Evidence links must start with https://').max(500)).max(5, 'At most 5 links.'),
});

/** Opens a dispute ticket for one of the viewer's own recorded days. The database checks everything again. */
export async function openDisputeAction(input: z.input<typeof openSchema>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to open a dispute.' };
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('open_dispute', {
    p_membership: parsed.data.membershipId,
    p_day: parsed.data.day,
    p_reason: parsed.data.reason,
    p_evidence: parsed.data.evidence,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/challenges/${parsed.data.address}`);
  revalidatePath('/dashboard/disputes');
  return { ok: true, id: data as string };
}
