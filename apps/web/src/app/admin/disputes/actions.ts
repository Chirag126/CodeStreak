'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const reviewSchema = z.object({
  id: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().min(5, 'Add a short note for the player (at least 5 characters).').max(1000),
});

/** Approve or reject a ticket. The database refuses anyone who isn't an admin (and reviewing twice). */
export async function reviewDisputeAction(input: z.input<typeof reviewSchema>): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('review_dispute', { p_dispute: parsed.data.id, p_approve: parsed.data.approve, p_note: parsed.data.note });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/disputes');
  return { ok: true, status: data as string };
}
