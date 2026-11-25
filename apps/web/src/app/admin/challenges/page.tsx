import type { Metadata } from 'next';
import { ChallengeTable } from '@/components/admin/challenge-table';
import { PageHeader } from '@/components/admin/ui';
import { pageOf } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Challenges' };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const state = ['open', 'settled', 'cancelled'].includes(one(sp.state)) ? one(sp.state) : 'all';
  return (
    <>
      <PageHeader title="Challenges" description="Every challenge on-chain, public and private." />
      <ChallengeTable basePath="/admin/challenges" visibility="all" q={one(sp.q).trim().slice(0, 80)} state={state} page={pageOf(sp.page)} />
    </>
  );
}
