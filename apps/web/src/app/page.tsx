import { CHALLENGE_DURATIONS_DAYS } from '@codestreak/shared';
import { Reveal } from '@/components/motion/primitives';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPublicEnv } from '@/lib/env';

// Read configuration at request time, not build time.
export const dynamic = 'force-dynamic';

// Scaffold home: proves config, shared package and design system work together.
// Phase 40 replaces it with the landing page.
export default function HomePage() {
  const env = getPublicEnv();
  const rows: [string, string][] = [
    ['Network', env.NEXT_PUBLIC_SOLANA_CLUSTER],
    ['RPC', new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL).host],
    ['Program', env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID ?? 'not deployed yet (Phase 9)'],
    ['Challenge lengths', CHALLENGE_DURATIONS_DAYS.map((d) => `${d} days`).join(' · ')],
  ];

  return (
    <div className="bg-dots">
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-20 sm:px-6">
        <Reveal trigger="mount" className="space-y-4">
          <Badge variant="primary">Devnet · tokens have no real value</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Put your money where your <span className="text-electric-400">commits</span> are.
          </h1>
          <p className="max-w-xl text-pretty text-muted-foreground">
            CodeStreak turns daily coding into a commitment you can verify: stake on your streak, prove it with GitHub and LeetCode, settle on Solana.
          </p>
        </Reveal>

        <Reveal trigger="mount" delay={0.1}>
          <Card>
            <CardHeader>
              <CardTitle>Build status</CardTitle>
              <CardDescription>Live configuration of this deployment.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-6 py-2.5 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate font-mono text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
