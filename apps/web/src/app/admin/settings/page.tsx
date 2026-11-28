import { PROGRAM_ID } from '@codestreak/shared/program';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ownerConfigFromEnv } from '@/lib/admin/identity';
import { requireOwnerPage } from '@/lib/admin/owner';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { voiceConfig } from '@/lib/voice/config';
import { accountUsage } from '@/lib/voice/eleven';
import { VoiceControls, type VoiceSettingsView } from '@/components/admin/voice-controls';

export const metadata: Metadata = { title: 'Platform Settings' };

const mask = (s: string | undefined) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : 'not set');
const set = (name: string) => (process.env[name] ? 'configured' : 'missing');

/** Read-only: configuration is changed in the hosting environment, never from a web page. */
export default async function SettingsPage() {
  const owner = await requireOwnerPage();
  const cfg = ownerConfigFromEnv();
  const voice = voiceConfig();
  const [{ data: voiceData }, usage] = await Promise.all([createSupabaseAdminClient().rpc('admin_voice_overview', { p_actor: owner.id }), accountUsage(voice)]);
  const vo = (voiceData ?? null) as VoiceOverview | null;
  const rows: [string, string][] = [
    ['Owner account', owner.email],
    ['Owner id (CODESTREAK_OWNER_ID)', mask(cfg.id)],
    ['Owner email check', cfg.emailSha256 ? 'SHA-256 hash (CODESTREAK_OWNER_EMAIL_SHA256)' : cfg.email ? 'Plain email (CODESTREAK_OWNER_EMAIL); prefer the hash' : 'missing'],
    ['Recent sign-in', owner.recentSignIn ? 'Yes: irreversible actions unlocked' : 'No: sign in again to ban, delete or rename'],
    ['Network', 'Solana devnet'],
    ['Program', PROGRAM_ID.toBase58()],
    ['RPC', process.env.NEXT_PUBLIC_SOLANA_RPC_URL ? 'custom' : 'public devnet'],
    ['Relayer key', process.env.RELAYER_KEYPAIR_JSON || process.env.RELAYER_KEYPAIR_PATH ? 'configured' : 'missing'],
    ['Supabase service role (server only)', set('SUPABASE_SERVICE_ROLE_KEY')],
  ];
  return (
    <>
      <PageHeader title="Platform Settings" description="Read-only. Configuration lives in the hosting environment (Render), never in the browser, so it can't be changed from a compromised session." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>Secrets are never shown: only whether they are set.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate text-right font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policies in force</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>One owner, no roles. A second admin is refused by the database.</li>
            <li>Every write is one atomic database call with a mandatory reason, idempotent per request, recorded in the hash-chained audit.</li>
            <li>Bans, deletions, permanent suspensions and username changes need a sign-in within the last 30 minutes and the username typed out.</li>
            <li>Suspended and banned users can still sign in to read the reason and appeal. Everything that moves money or creates content is blocked.</li>
            <li>Deletion keeps on-chain history and financial records (public and audited) and removes personal data after a grace period.</li>
            <li>Private chats (future): reported messages only, every access audited. Nothing is browsable from the user directory.</li>
          </ul>
        </CardContent>
      </Card>
      <VoiceSection voice={voice} overview={vo} usage={usage} />
    </>
  );
}

interface VoiceOverview {
  settings: VoiceSettingsView;
  month: { generated: number; cached: number; fallbacks: number; errors: number; chars: number; briefings: number; announcements: number; users: number };
  clips: { count: number; plays: number };
  recent_errors: { at: string; kind: string; error: string | null }[];
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Phase 41.2 - the voice companion: switches, limits and usage (small on purpose). */
function VoiceSection({ voice, overview, usage }: { voice: ReturnType<typeof voiceConfig>; overview: VoiceOverview | null; usage: Awaited<ReturnType<typeof accountUsage>> }) {
  const m = overview?.month;
  const served = (m?.generated ?? 0) + (m?.cached ?? 0);
  const hitRate = served > 0 ? Math.round(((m?.cached ?? 0) / served) * 100) : null;
  const tiles: [string, string, string][] = [
    ['Audio generated', fmt(m?.generated ?? 0), 'this month (UTC)'],
    ['Served from cache', hitRate === null ? '–' : `${hitRate}%`, `${fmt(m?.cached ?? 0)} replays, no credits`],
    ['Characters sent', fmt(m?.chars ?? 0), 'counted by CodeStreak (estimate of credits)'],
    ['Fallbacks · errors', `${fmt(m?.fallbacks ?? 0)} · ${fmt(m?.errors ?? 0)}`, 'browser voice used instead'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Voice companion (ElevenLabs)</CardTitle>
        <CardDescription>
          One voice for everyone, set in Render: ELEVENLABS_VOICE_ID ({voice.voiceId}) and ELEVENLABS_MODEL_ID ({voice.modelId}). Key:{' '}
          {voice.apiKey ? 'configured' : voice.keyProblem ?? 'missing (browsers read aloud instead)'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {overview ? <VoiceControls initial={overview.settings} /> : <p className="text-sm text-destructive-text">Voice settings couldn&apos;t be loaded.</p>}
        <dl className="grid gap-3 sm:grid-cols-4">
          {tiles.map(([k, v, hint]) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
          ))}
        </dl>
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">ElevenLabs account (reported by ElevenLabs)</p>
          {usage === null ? (
            <p className="text-muted-foreground">Not available: no API key is configured.</p>
          ) : 'error' in usage ? (
            <p className="text-muted-foreground">Not available: {usage.error}</p>
          ) : (
            <p className="text-muted-foreground">
              {usage.tier} plan: {fmt(usage.used)} of {fmt(usage.limit)} credits used
              {usage.resetsAt ? `, resets ${new Date(usage.resetsAt * 1000).toISOString().slice(0, 10)}` : ''}. This includes anything else on the account, not only CodeStreak.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            This month: {fmt(m?.briefings ?? 0)} briefings and {fmt(m?.announcements ?? 0)} announcements for {fmt(m?.users ?? 0)} players. {fmt(overview?.clips.count ?? 0)} clips cached.
          </p>
        </div>
        {overview && overview.recent_errors.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Recent errors</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {overview.recent_errors.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono">{new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')}</span>
                  <span className="shrink-0">{e.kind}</span>
                  <span className="min-w-0 break-words">{e.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
