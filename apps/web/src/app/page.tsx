import { CHALLENGE_DURATIONS_DAYS } from '@codestreak/shared';
import { getPublicEnv } from '@/lib/env';

// Read configuration at request time, not build time.
export const dynamic = 'force-dynamic';

// Phase 3 scaffold page: proves the web app builds, reads validated config and uses the shared package.
// Phase 4 (design system) and Phase 40 (landing page) replace it.
export default function HomePage() {
  const env = getPublicEnv();
  const rpcHost = new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL).host;
  const rows: [string, string][] = [
    ['Network', env.NEXT_PUBLIC_SOLANA_CLUSTER],
    ['RPC', rpcHost],
    ['Program', env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID ?? 'not deployed yet (Phase 9)'],
    ['Challenge lengths', CHALLENGE_DURATIONS_DAYS.map((d) => `${d}d`).join(' · ')],
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <span className="inline-flex rounded-full bg-charcoal-800 px-3 py-1 text-xs font-medium text-electric-400">
          Devnet · tokens have no real value
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">CodeStreak</h1>
        <p className="text-neutral-400">Put your money where your commits are. App scaffold is running.</p>
      </div>
      <dl className="divide-y divide-charcoal-700 rounded-xl border border-charcoal-700 bg-charcoal-900">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-6 px-5 py-3 text-sm">
            <dt className="text-neutral-400">{label}</dt>
            <dd className="truncate font-mono text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
