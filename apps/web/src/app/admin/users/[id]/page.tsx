import { formatAmount } from '@codestreak/shared';
import { explorerAddressUrl, explorerTxUrl } from '@codestreak/shared/program';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DecisionButton, ModerationPanel } from '@/components/admin/moderation-panel';
import { Empty, short, StatCard, StatusBadge, Table, td, when } from '@/components/admin/ui';
import { TimeseriesChart } from '@/components/admin/timeseries-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadUserDetail, type UserDetail } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';
import { nowSecs } from '@/lib/insights/load';

export const metadata: Metadata = { title: 'User' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;
const amt = (v: unknown, token: string) => `${formatAmount(BigInt(String(v ?? 0)), token === 'sol' ? 9 : 6)} ${token.toUpperCase()}`;

/** The rules-engine confidence inside a sealed day receipt, wherever the engine version put it. */
function confidenceOf(receipt: unknown): number | null {
  const r = receipt as Record<string, unknown> | null;
  if (!r) return null;
  for (const v of [r.confidence, (r.decision as Row | undefined)?.confidence, (r.verdict as Row | undefined)?.confidence]) if (typeof v === 'number') return v;
  return null;
}

const CHAIN: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'outline' }> = {
  finalized: { label: 'On-chain · finalized', variant: 'success' },
  confirmed: { label: 'On-chain · confirmed', variant: 'success' },
  processed: { label: 'On-chain · processed', variant: 'warning' },
  failed: { label: 'On-chain · failed', variant: 'danger' },
  not_found: { label: 'Not found on-chain', variant: 'danger' },
  unknown: { label: 'Chain unreachable', variant: 'outline' },
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const now = nowSecs();
  const d = await loadUserDetail(owner.id, id, now);
  if (!d) notFound();
  const p = d.profile as Row;
  const m = (d.moderation ?? {}) as Row;
  const status = String(m.status ?? (p.username ? 'active' : 'pending'));
  const restrictions = (m.restrictions as string[] | undefined) ?? [];
  const activeFlags = (d.flags as Row[]).filter((f) => !f.removed_at).map((f) => String(f.flag));
  const isSelf = id === owner.id;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center">
          {p.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(p.avatar_url)} alt="" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-full border border-border object-cover" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold">{String(p.username ?? '?').slice(0, 2).toUpperCase()}</span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{String(p.display_name ?? (p.username ? `@${p.username}` : 'No username yet'))}</h1>
              <StatusBadge status={restrictions.length && status === 'active' ? 'restricted' : status} />
              {activeFlags.map((f) => (
                <Badge key={f} variant="danger">
                  {f}
                </Badge>
              ))}
            </div>
            <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              {p.username ? <Link className="hover:underline" href={`/u/${p.username}`}>@{String(p.username)}</Link> : null}
              <span>{d.auth?.email ?? 'no email'}</span>
              <span className="font-mono">{String(p.public_id)}</span>
              <span className="font-mono text-xs">{id}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ModerationPanel
              userId={id}
              username={(p.username as string | null) ?? null}
              current={{ restrictions }}
              flags={activeFlags}
              actions={isSelf ? ['edit_profile', 'note_add'] : undefined}
              triggerLabel={isSelf ? 'Edit / note' : 'Take action'}
              triggerVariant="default"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap">
          {['overview', 'progress', 'groups', 'transactions', 'verification', 'reports', 'activity'].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <Overview d={d} status={status} />
        </TabsContent>
        <TabsContent value="progress" className="space-y-4">
          <Progress d={d} nowMs={now * 1000} />
        </TabsContent>
        <TabsContent value="groups" className="space-y-4">
          <Groups d={d} userId={id} />
        </TabsContent>
        <TabsContent value="transactions" className="space-y-4">
          <Transactions d={d} />
        </TabsContent>
        <TabsContent value="verification" className="space-y-4">
          <Verification d={d} />
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <Reports d={d} userId={id} username={(p.username as string | null) ?? null} />
        </TabsContent>
        <TabsContent value="activity" className="space-y-4">
          <ActivityTab d={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Overview({ d, status }: { d: UserDetail; status: string }) {
  const p = d.profile as Row;
  const m = (d.moderation ?? {}) as Row;
  return (
    <>
      <Section title="Profile" description="Stored profile fields.">
        <Fields
          rows={[
            ['Display name', String(p.display_name ?? '—')],
            ['Username', p.username ? `@${p.username}` : '—'],
            ['Bio', String(p.bio ?? '—')],
            ['Time zone', String(p.timezone)],
            ['Public ID', String(p.public_id)],
            ['Registered', when(p.created_at as string)],
            ['Profile updated', when(p.updated_at as string)],
            ['Picture', p.avatar_url ? <a className="underline" href={String(p.avatar_url)} target="_blank" rel="noreferrer">open</a> : '—'],
          ]}
        />
      </Section>
      <Section title="Sign-in & email" description="From Supabase Auth. Passwords, tokens and secrets are never read.">
        <Fields
          rows={[
            ['Email', d.auth?.email ?? '—'],
            ['Email verified', d.auth?.email_confirmed_at ? `Yes · ${when(d.auth.email_confirmed_at)}` : 'No'],
            ['Last sign-in', when(d.auth?.last_sign_in_at)],
            ['Auth account created', when(d.auth?.created_at)],
            ['Login locked until', d.auth?.banned_until ? when(d.auth.banned_until) : 'Not locked'],
          ]}
        />
      </Section>
      <Section title="Connected accounts & wallets">
        {d.linked.length + d.wallets.length === 0 ? (
          <Empty>No linked accounts or wallets.</Empty>
        ) : (
          <Table head={['Type', 'Identity', 'Details', 'Linked']}>
            {(d.linked as Row[]).map((l) => (
              <tr key={String(l.provider)}>
                <td className={td}>{l.provider === 'github' ? 'GitHub' : 'LeetCode'}</td>
                <td className={td}>
                  <a className="underline underline-offset-4" href={l.provider === 'github' ? `https://github.com/${l.provider_username}` : `https://leetcode.com/u/${l.provider_username}/`} target="_blank" rel="noreferrer nofollow">
                    {String(l.provider_username)}
                  </a>
                </td>
                <td className={`${td} font-mono text-xs`}>provider id {String(l.provider_user_id)}</td>
                <td className={td}>{when(l.linked_at as string)}</td>
              </tr>
            ))}
            {(d.wallets as Row[]).map((w) => (
              <tr key={String(w.address)}>
                <td className={td}>Wallet ({String(w.kind)})</td>
                <td className={`${td} font-mono text-xs`}>
                  <a className="underline" href={explorerAddressUrl(String(w.address))} target="_blank" rel="noreferrer">
                    {String(w.address)}
                  </a>
                </td>
                <td className={td}>
                  {w.is_primary ? 'Primary · ' : ''}
                  {w.verified_at ? 'Ownership signed' : 'Not verified'}
                </td>
                <td className={td}>{when(w.created_at as string)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <Section title="Account status">
        <Fields
          rows={[
            ['Status', <StatusBadge key="s" status={status} />],
            ['Suspended until', m.status === 'suspended' ? (m.suspended_until ? when(m.suspended_until as string) : 'Permanent') : '—'],
            ['Restrictions', ((m.restrictions as string[] | undefined) ?? []).join(', ') || 'None'],
            ['Message shown to the user', String(m.public_reason ?? '—')],
            ['Warnings', String(m.warnings ?? 0)],
            ['Deletion due', when(m.deletion_due_at as string | null)],
          ]}
        />
      </Section>
      <Section title="Internal notes" description="Private to the Control Center.">
        {d.notes.length === 0 ? (
          <Empty>No notes.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {(d.notes as Row[]).map((n) => (
              <li key={String(n.id)} className="rounded-md border border-border p-3">
                <p className="whitespace-pre-wrap">{String(n.body)}</p>
                <p className="pt-1 text-xs text-muted-foreground">{when(n.created_at as string)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Progress({ d, nowMs }: { d: UserDetail; nowMs: number }) {
  const results = d.results as Row[];
  const shielded = new Set((d.shields as Row[]).map((s) => `${s.membership_id}:${s.day}`));
  const verified = results.filter((r) => r.result === 'verified' && r.onchain_at).length;
  const failed = results.filter((r) => r.result === 'failed' && r.onchain_at && !shielded.has(`${r.membership_id}:${r.day}`)).length;
  const ms = d.memberships as Row[];
  const count = (pred: (m: Row) => boolean) => ms.filter(pred).length;
  const tokenOf = (m: Row) => String(one<Row>(m.challenges).token);
  const earned: Record<string, bigint> = {};
  const claimed: Record<string, bigint> = {};
  for (const m of ms) {
    const t = tokenOf(m);
    if (m.status === 'survived' && m.payout !== null && BigInt(String(m.payout)) > BigInt(String(m.deposited))) earned[t] = (earned[t] ?? 0n) + BigInt(String(m.payout)) - BigInt(String(m.deposited));
    if (m.payout !== null && m.claimed_at) claimed[t] = (claimed[t] ?? 0n) + BigInt(String(m.payout));
  }
  // Daily chart from on-chain-recorded results (last 60 days).
  const byDay = new Map<string, { date: string; verified: number; failed: number; undecided: number }>();
  for (let i = 59; i >= 0; i--) {
    const date = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10);
    byDay.set(date, { date, verified: 0, failed: 0, undecided: 0 });
  }
  for (const r of results) {
    const day = byDay.get(String(r.onchain_at ?? '').slice(0, 10));
    if (!day) continue;
    if (r.result === 'verified') day.verified++;
    else if (r.result === 'failed') day.failed++;
    else day.undecided++;
  }
  const leetcode = (d.evidence as Row[]).filter((e) => e.provider === 'leetcode');
  const github = (d.evidence as Row[]).filter((e) => e.provider === 'github');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current streak" value={`${d.streak.current} days`} hint={`Longest ${d.streak.longest}`} />
        <StatCard label="Success rate" value={d.streak.successRate === null ? '—' : `${d.streak.successRate}%`} hint={`${d.streak.recorded} recorded days`} />
        <StatCard label="Verified · failed days" value={`${verified} · ${failed}`} hint={`${shielded.size} Shield-covered`} />
        <StatCard
          label="Challenges"
          value={`${count((m) => m.status === 'survived')} / ${ms.length}`}
          hint={`completed / joined · ${count((m) => m.status === 'failed')} failed · ${count((m) => m.status === 'voided')} voided (abandoned) · ${count((m) => m.status === 'active')} active`}
        />
      </div>
      <Section title="Daily activity" description="Days recorded on-chain, last 60 days (UTC).">
        <TimeseriesChart
          data={[...byDay.values()]}
          bars={[
            { key: 'verified', label: 'Verified' },
            { key: 'undecided', label: 'Undecided' },
            { key: 'failed', label: 'Failed' },
          ]}
        />
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Rewards" description="Earned = above the stake (survivors). Claimed = every payout received.">
          <Fields
            rows={[
              ['Earned', Object.entries(earned).map(([t, v]) => amt(v, t)).join(' · ') || '—'],
              ['Received in total', Object.entries(claimed).map(([t, v]) => amt(v, t)).join(' · ') || '—'],
            ]}
          />
        </Section>
        <Section title="Coding evidence" description="Items the verifier saw (latest 2000).">
          <Fields
            rows={[
              ['GitHub items · counted', `${github.length} · ${github.filter((e) => e.counted).length}`],
              ['LeetCode items · counted', `${leetcode.length} · ${leetcode.filter((e) => e.counted).length}`],
            ]}
          />
        </Section>
      </div>
      <Section title="Badges">
        {d.badges.length === 0 ? (
          <Empty>No badges.</Empty>
        ) : (
          <Table head={['Badge', 'Mint', 'Mint transaction', 'Awarded']}>
            {(d.badges as Row[]).map((b) => (
              <tr key={String(b.challenge_id)}>
                <td className={td}>{String(b.badge_code)}</td>
                <td className={`${td} font-mono text-xs`}>{b.mint_address ? <a className="underline" href={explorerAddressUrl(String(b.mint_address))} target="_blank" rel="noreferrer">{short(String(b.mint_address), 6)}</a> : 'pending'}</td>
                <td className={`${td} font-mono text-xs`}>{b.mint_tx ? <a className="underline" href={explorerTxUrl(String(b.mint_tx))} target="_blank" rel="noreferrer">{short(String(b.mint_tx), 6)}</a> : '—'}</td>
                <td className={td}>{when(b.awarded_at as string)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

function Groups({ d, userId }: { d: UserDetail; userId: string }) {
  return (
    <>
      <Section title="Challenges & groups joined" description="Private challenges are groups. Owner = created it.">
        {d.memberships.length === 0 ? (
          <Empty>Never joined a challenge.</Empty>
        ) : (
          <Table head={['Challenge', 'Type', 'Role', 'Status', 'Stake → payout', 'Joined']}>
            {(d.memberships as Row[]).map((mm) => {
              const c = one<Row>(mm.challenges);
              return (
                <tr key={String(mm.id)}>
                  <td className={td}>{c.onchain_address ? <Link className="underline underline-offset-4" href={`/challenges/${c.onchain_address}`}>{String(c.title)}</Link> : String(c.title)}</td>
                  <td className={td}>{c.visibility === 'private' ? 'Group (private)' : 'Public'}</td>
                  <td className={td}>{c.creator_id === userId ? 'Owner' : 'Member'}</td>
                  <td className={td}>
                    {String(mm.status)} · <span className="text-muted-foreground">{String(c.pool_state)}</span>
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {amt(mm.deposited, String(c.token))} → {mm.payout === null ? '—' : amt(mm.payout, String(c.token))}
                  </td>
                  <td className={td}>{when(mm.joined_at as string)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
      <Section title="Created">
        {d.created.length === 0 ? (
          <Empty>Created nothing.</Empty>
        ) : (
          <Table head={['Challenge', 'Type', 'State', 'Created']}>
            {(d.created as Row[]).map((c) => (
              <tr key={String(c.id)}>
                <td className={td}>{String(c.title)}</td>
                <td className={td}>{c.visibility === 'private' ? 'Group' : 'Public'}</td>
                <td className={td}>{String(c.pool_state)}</td>
                <td className={td}>{when(c.created_at as string)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Invitations sent">
          {d.invitesSent.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {(d.invitesSent as Row[]).map((i) => (
                <li key={String(i.id)}>
                  {String(one<Row>(i.challenges).title)} → {one<Row | null>(i.invitee)?.username ? `@${one<Row>(i.invitee).username}` : 'link'} · {String(i.status)} · <span className="text-muted-foreground">{when(i.created_at as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Invitations received">
          {d.invitesReceived.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {(d.invitesReceived as Row[]).map((i) => (
                <li key={String(i.id)}>
                  {String(one<Row>(i.challenges).title)} from @{String(one<Row | null>(i.inviter)?.username ?? '?')} · {String(i.status)} · <span className="text-muted-foreground">{when(i.created_at as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Sponsorships made">
        {d.sponsorships.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table head={['Challenge', 'Amount', 'Message', 'Transaction', 'When']}>
            {(d.sponsorships as Row[]).map((s) => {
              const c = one<Row>(s.challenges);
              return (
                <tr key={String(s.id)}>
                  <td className={td}>{String(c.title)}</td>
                  <td className={td}>{amt(s.amount, String(c.token))}</td>
                  <td className={td}>{String(s.message ?? '—')}</td>
                  <td className={`${td} font-mono text-xs`}>
                    <a className="underline" href={explorerTxUrl(String(s.tx_signature))} target="_blank" rel="noreferrer">
                      {short(String(s.tx_signature), 6)}
                    </a>
                  </td>
                  <td className={td}>{when(s.created_at as string)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </>
  );
}

function Transactions({ d }: { d: UserDetail }) {
  return (
    <>
      <Section title="Confirmed transactions" description="Mirrored receipts, each re-checked against Solana devnet right now (status column).">
        {d.receipts.length === 0 ? (
          <Empty>No transactions.</Empty>
        ) : (
          <Table head={['Kind', 'Amount', 'Token mint', 'Challenge', 'Signature', 'On-chain status', 'Time (UTC)']} minWidth="64rem">
            {(d.receipts as Row[]).map((r) => {
              const c = one<Row>(r.challenges);
              const st = CHAIN[d.onchain[String(r.tx_signature)] ?? 'unknown']!;
              return (
                <tr key={String(r.id)}>
                  <td className={td}>{String(r.kind).replace('_', ' ')}</td>
                  <td className={`${td} tabular-nums`}>{amt(r.amount, String(c.token))}</td>
                  <td className={`${td} font-mono text-xs`}>{short(String(c.mint), 5)}</td>
                  <td className={td}>{String(c.title)}</td>
                  <td className={`${td} font-mono text-xs`}>
                    <a className="underline" href={explorerTxUrl(String(r.tx_signature))} target="_blank" rel="noreferrer">
                      {short(String(r.tx_signature), 6)}
                    </a>
                  </td>
                  <td className={td}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </td>
                  <td className={td}>{when(r.confirmed_at as string)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
      <Section title="Relayed requests (app records)" description="What CodeStreak prepared for the user to sign, including failed and pending ones. Not proof of a transfer by themselves.">
        {d.relayer.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table head={['Kind', 'Status', 'Signature', 'Error', 'Created']}>
            {(d.relayer as Row[]).map((r) => (
              <tr key={String(r.id)}>
                <td className={td}>{String(r.kind)}</td>
                <td className={td}>
                  <Badge variant={r.status === 'confirmed' ? 'success' : r.status === 'failed' ? 'danger' : 'outline'}>{String(r.status)}</Badge>
                </td>
                <td className={`${td} font-mono text-xs`}>{r.signature ? <a className="underline" href={explorerTxUrl(String(r.signature))} target="_blank" rel="noreferrer">{short(String(r.signature), 6)}</a> : '—'}</td>
                <td className={`${td} max-w-xs truncate text-xs`} title={String(r.error ?? '')}>
                  {String(r.error ?? '—')}
                </td>
                <td className={td}>{when(r.created_at as string)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

function Verification({ d }: { d: UserDetail }) {
  const receiptOf = new Map((d.dayReceipts as Row[]).map((r) => [`${r.membership_id}:${r.day}`, r]));
  const titleOf = new Map((d.memberships as Row[]).map((m) => [String(m.id), String(one<Row>(m.challenges).title)]));
  const shielded = new Set((d.shields as Row[]).map((s) => `${s.membership_id}:${s.day}`));
  return (
    <>
      <Section title="Day results" description="Recorded verdicts with their sealed receipt (engine, confidence, evidence hash).">
        {d.results.length === 0 ? (
          <Empty>No recorded days.</Empty>
        ) : (
          <Table head={['Challenge', 'Day', 'Result', 'Confidence', 'Evidence', 'Hash', 'Record tx', 'Recorded']} minWidth="64rem">
            {(d.results as Row[]).map((r) => {
              const rec = receiptOf.get(`${r.membership_id}:${r.day}`);
              const conf = confidenceOf(rec?.receipt);
              return (
                <tr key={`${r.membership_id}:${r.day}`}>
                  <td className={td}>{titleOf.get(String(r.membership_id))}</td>
                  <td className={td}>{Number(r.day) + 1}</td>
                  <td className={td}>
                    <Badge variant={r.result === 'verified' ? 'success' : r.result === 'failed' ? 'danger' : 'warning'}>{String(r.result)}</Badge>
                    {shielded.has(`${r.membership_id}:${r.day}`) && <span className="ml-1 text-xs">🛡</span>}
                  </td>
                  <td className={td}>{conf === null ? '—' : conf}</td>
                  <td className={td}>
                    {String(r.evidence_count ?? 0)} · {String(r.source ?? '—')}
                    {rec && <span className="block text-xs text-muted-foreground">{String(rec.engine)}</span>}
                  </td>
                  <td className={`${td} font-mono text-xs`} title={String(r.evidence_hash ?? '')}>
                    {short(String(r.evidence_hash ?? ''), 6)}
                  </td>
                  <td className={`${td} font-mono text-xs`}>{r.record_tx ? <a className="underline" href={explorerTxUrl(String(r.record_tx))} target="_blank" rel="noreferrer">{short(String(r.record_tx), 5)}</a> : 'not on-chain yet'}</td>
                  <td className={td}>{when(r.onchain_at as string | null)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Disputes">
          {d.disputes.length === 0 ? (
            <Empty>No disputes.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(d.disputes as Row[]).map((x) => (
                <li key={String(x.id)} className="rounded-md border border-border p-3">
                  {String(one<Row>(one<Row>(x.memberships).challenges).title)} · day {Number(x.day) + 1} · <Badge variant="outline">{String(x.status)}</Badge>
                  <p className="text-xs text-muted-foreground">
                    was {String(x.previous_result)} · {when(x.created_at as string)}
                    {x.resolution_tx ? (
                      <>
                        {' · '}
                        <a className="underline" href={explorerTxUrl(String(x.resolution_tx))} target="_blank" rel="noreferrer">
                          resolution tx
                        </a>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-xs">
            <Link className="underline underline-offset-4" href="/admin/disputes">
              Dispute review queue
            </Link>
          </p>
        </Section>
        <Section title="Shields">
          {d.shields.length === 0 ? (
            <Empty>No Shields.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {(d.shields as Row[]).map((s) => (
                <li key={`${s.membership_id}:${s.day}`}>
                  {titleOf.get(String(s.membership_id))} · day {Number(s.day) + 1} · {when(s.activated_at as string)}{' '}
                  <a className="text-xs underline" href={explorerTxUrl(String(s.tx_signature))} target="_blank" rel="noreferrer">
                    tx
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function Reports({ d, userId, username }: { d: UserDetail; userId: string; username: string | null }) {
  return (
    <>
      <Section title="Reports against this user">
        {d.reportsAgainst.length === 0 ? (
          <Empty>No reports.</Empty>
        ) : (
          <Table head={['Reason', 'Details', 'From', 'Status', 'When', '']}>
            {(d.reportsAgainst as Row[]).map((r) => (
              <tr key={String(r.id)}>
                <td className={td}>{String(r.reason)}</td>
                <td className={`${td} max-w-xs whitespace-pre-wrap text-xs`}>{String(r.details ?? '—')}</td>
                <td className={td}>@{String(one<Row | null>(r.reporter)?.username ?? 'deleted')}</td>
                <td className={td}>
                  <Badge variant="outline">{String(r.status)}</Badge>
                  {r.resolution ? <span className="block text-xs text-muted-foreground">{String(r.resolution)}</span> : null}
                </td>
                <td className={td}>{when(r.created_at as string)}</td>
                <td className={`${td} space-x-1 whitespace-nowrap`}>
                  {(r.status === 'open' || r.status === 'reviewing') && (
                    <>
                      <DecisionButton userId={userId} username={username} action="report_set" params={{ report_id: r.id, status: 'actioned' }} label="Actioned" />
                      <DecisionButton userId={userId} username={username} action="report_set" params={{ report_id: r.id, status: 'dismissed' }} label="Dismiss" />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <Section title="Appeals">
        {d.appeals.length === 0 ? (
          <Empty>No appeals.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {(d.appeals as Row[]).map((a) => (
              <li key={String(a.id)} className="space-y-1 rounded-md border border-border p-3">
                <p className="whitespace-pre-wrap">{String(a.message)}</p>
                <p className="text-xs text-muted-foreground">
                  {String(a.status)} · {when(a.created_at as string)}
                  {a.decision_note ? ` · ${a.decision_note}` : ''}
                </p>
                {a.status === 'open' && (
                  <div className="flex gap-2 pt-1">
                    <DecisionButton userId={userId} username={username} action="appeal_decide" params={{ appeal_id: a.id, accept: true }} label="Accept & reinstate" variant="default" />
                    <DecisionButton userId={userId} username={username} action="appeal_decide" params={{ appeal_id: a.id, accept: false }} label="Reject" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Moderation history" description="Every action, with the status before and after.">
        {d.actions.length === 0 ? (
          <Empty>No actions yet.</Empty>
        ) : (
          <Table head={['Action', 'Reason', 'Before → after', 'When']}>
            {(d.actions as Row[]).map((a) => (
              <tr key={String(a.id)}>
                <td className={td}>{String(a.action).replace('_', ' ')}</td>
                <td className={`${td} text-xs`}>{String(a.reason)}</td>
                <td className={`${td} text-xs`}>
                  {String((a.before as Row).status)} → {String((a.after as Row).status)}
                </td>
                <td className={td}>{when(a.created_at as string)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Flag history">
          {d.flags.length === 0 ? (
            <Empty>No flags.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {(d.flags as Row[]).map((f) => (
                <li key={String(f.id)}>
                  <Badge variant={f.removed_at ? 'outline' : 'danger'}>{String(f.flag)}</Badge> {String(f.reason)} · <span className="text-xs text-muted-foreground">{when(f.added_at as string)}{f.removed_at ? ` → removed ${when(f.removed_at as string)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Reports this user sent">
          {d.reportsBy.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {(d.reportsBy as Row[]).map((r) => (
                <li key={String(r.id)}>
                  @{String(one<Row | null>(r.reported)?.username ?? 'deleted')} · {String(r.reason)} · {String(r.status)} · <span className="text-xs text-muted-foreground">{when(r.created_at as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function ActivityTab({ d }: { d: UserDetail }) {
  type Ev = { at: string; what: string };
  const ev: Ev[] = [];
  const p = d.profile as Row;
  ev.push({ at: String(p.created_at), what: 'Registered' });
  if (d.auth?.last_sign_in_at) ev.push({ at: d.auth.last_sign_in_at, what: 'Last sign-in' });
  for (const w of d.wallets as Row[]) ev.push({ at: String(w.created_at), what: `Wallet linked ${short(String(w.address))}` });
  for (const l of d.linked as Row[]) ev.push({ at: String(l.linked_at), what: `${l.provider === 'github' ? 'GitHub' : 'LeetCode'} linked (${l.provider_username})` });
  for (const m of d.memberships as Row[]) ev.push({ at: String(m.joined_at), what: `Joined ${one<Row>(m.challenges).title}` });
  for (const m of d.memberships as Row[]) if (m.claimed_at) ev.push({ at: String(m.claimed_at), what: `Paid out from ${one<Row>(m.challenges).title}` });
  for (const a of d.audit as Row[]) ev.push({ at: String(a.at), what: `Admin: ${String(a.action).replace('moderate.', '').replace('view.', 'viewed ')}${a.reason ? ` (${a.reason})` : ''}` });
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <Section title="Timeline" description="Built from stored records only: sign-ins (latest only, as Supabase keeps it), links, joins, payouts and admin actions.">
        <ol className="space-y-1.5 text-sm">
          {ev.slice(0, 200).map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">{when(e.at)}</span>
              <span>{e.what}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Recent notifications sent">
        {d.notifications.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {(d.notifications as Row[]).map((n, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-muted-foreground">{when(n.created_at as string)}</span> {String(n.title)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
