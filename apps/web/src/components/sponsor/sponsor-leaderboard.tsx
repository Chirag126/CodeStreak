import { formatAmount } from '@codestreak/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SponsorRow } from '@/lib/sponsor/load';

const explorer = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

/** Sponsors, biggest first, each with links to their on-chain receipt and latest transaction. */
export function SponsorLeaderboard({ sponsors, decimals, symbol, totalSponsor, action }: { sponsors: SponsorRow[]; decimals: number; symbol: string; totalSponsor: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Sponsors</CardTitle>
          <Badge variant="outline">
            {formatAmount(BigInt(totalSponsor), decimals)} {symbol} sponsored
          </Badge>
          {action && <div className="ml-auto">{action}</div>}
        </div>
        <CardDescription>Sponsors add to the reward pool without playing. Every sponsorship has an on-chain receipt.</CardDescription>
      </CardHeader>
      <CardContent>
        {sponsors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sponsors yet. Be the first.</p>
        ) : (
          <ol className="divide-y divide-border">
            {sponsors.map((s, i) => (
              <li key={s.wallet} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-6 font-mono text-xs text-muted-foreground">{i + 1}.</span>
                <span className="font-medium">{s.name}</span>
                {s.publicId && <span className="font-mono text-xs text-muted-foreground">{s.publicId}</span>}
                {s.message && <span className="text-xs text-muted-foreground italic">“{s.message}”</span>}
                <span className="ml-auto font-mono">
                  {formatAmount(BigInt(s.total), decimals)} {symbol}
                </span>
                <span className="flex w-full gap-3 pl-9 text-xs text-muted-foreground sm:w-auto sm:pl-0">
                  {s.contributions > 1 && <span>{s.contributions} times</span>}
                  {s.receipt && (
                    <a className="underline underline-offset-4" href={explorer('address', s.receipt)} target="_blank" rel="noreferrer">
                      Receipt ↗
                    </a>
                  )}
                  <a className="underline underline-offset-4" href={explorer('tx', s.lastTx)} target="_blank" rel="noreferrer">
                    Latest tx ↗
                  </a>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
