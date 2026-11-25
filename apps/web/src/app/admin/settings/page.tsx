import { PROGRAM_ID } from '@codestreak/shared/program';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ownerConfigFromEnv } from '@/lib/admin/identity';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Platform Settings' };

const mask = (s: string | undefined) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : 'not set');
const set = (name: string) => (process.env[name] ? 'configured' : 'missing');

/** Read-only: configuration is changed in the hosting environment, never from a web page. */
export default async function SettingsPage() {
  const owner = await requireOwnerPage();
  const cfg = ownerConfigFromEnv();
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
    </>
  );
}
