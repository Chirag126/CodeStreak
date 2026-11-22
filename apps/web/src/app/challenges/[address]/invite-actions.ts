'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createInviteLink, inviteByPublicId, revokeInvite, type GroupResult } from '@/lib/groups/invites';
import { getViewer } from '@/lib/supabase/server';

async function appUrl(): Promise<string> {
  return process.env.APP_URL?.trim() || (await headers()).get('origin') || 'http://localhost:3000';
}

export async function inviteByIdAction(address: string, publicId: string): Promise<GroupResult<{ name: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await inviteByPublicId(viewer.userId, address, String(publicId).slice(0, 40));
  revalidatePath(`/challenges/${address}`);
  return r;
}

export async function createLinkAction(address: string, maxUses: number, hours: number): Promise<GroupResult<{ url: string; expiresAt: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await createInviteLink(viewer.userId, address, { maxUses: Number(maxUses), hours: Number(hours) }, await appUrl());
  revalidatePath(`/challenges/${address}`);
  return r;
}

export async function revokeInviteAction(address: string, inviteId: string): Promise<GroupResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await revokeInvite(viewer.userId, String(inviteId));
  revalidatePath(`/challenges/${address}`);
  return r;
}
