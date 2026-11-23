import { challengeStatus } from '@codestreak/shared';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { STATUS_LABEL } from './challenge-card';

export interface MyChallenge {
  address: string;
  title: string;
  role: 'Creator' | 'Player' | 'Creator · Player';
  status: keyof typeof STATUS_LABEL;
  isDemo: boolean;
  isPrivate: boolean;
}

/** Challenges the person created or plays in, newest first (server-only, their own rows only). */
export async function listMyChallenges(profileId: string): Promise<MyChallenge[]> {
  const admin = createSupabaseAdminClient();
  const [{ data: memberships }, { data: created }] = await Promise.all([
    admin.from('memberships').select('challenge_id').eq('profile_id', profileId).limit(100),
    admin.from('challenges').select('id').eq('creator_id', profileId).limit(100),
  ]);
  const playing = new Set((memberships ?? []).map((m) => m.challenge_id as string));
  const mine = new Set((created ?? []).map((c) => c.id as string));
  const ids = [...new Set([...playing, ...mine])];
  if (ids.length === 0) return [];
  const { data: rows } = await admin
    .from('challenges')
    .select('id, title, onchain_address, pool_state, visibility, is_demo, join_deadline_at, start_at, day_length_secs, num_days')
    .in('id', ids)
    .not('onchain_address', 'is', null)
    .order('start_at', { ascending: false })
    .limit(20);
  const now = Date.now();
  return (rows ?? []).map((r) => {
    const startMs = Date.parse(r.start_at as string);
    return {
      address: r.onchain_address as string,
      title: r.title as string,
      role: mine.has(r.id as string) && playing.has(r.id as string) ? 'Creator · Player' : mine.has(r.id as string) ? 'Creator' : 'Player',
      status: challengeStatus(
        {
          poolState: r.pool_state as 'open' | 'cancelled' | 'settled',
          joinDeadlineMs: Date.parse(r.join_deadline_at as string),
          startMs,
          endMs: startMs + (r.num_days as number) * (r.day_length_secs as number) * 1000,
        },
        now,
      ),
      isDemo: Boolean(r.is_demo),
      isPrivate: r.visibility === 'private',
    };
  });
}

export function MyChallenges({ items }: { items: MyChallenge[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Your challenges</CardTitle>
          <CardDescription>Ones you created or play in.</CardDescription>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/challenges/new">Create a challenge</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Create one, or join one from{' '}
            <Link className="underline underline-offset-4" href="/challenges">
              Challenges
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((c) => (
              <li key={c.address}>
                <Link href={`/challenges/${c.address}`} className="flex flex-wrap items-center gap-2 py-2.5 text-sm hover:text-foreground">
                  <span className="font-medium">{c.title}</span>
                  <Badge variant={STATUS_LABEL[c.status].variant}>{STATUS_LABEL[c.status].label}</Badge>
                  {c.isDemo && <Badge variant="warning">DEMO</Badge>}
                  {c.isPrivate && <Badge variant="accent">Private</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{c.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
