import Link from 'next/link';
import { Stagger, StaggerItem } from '@/components/motion/primitives';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { BadgeView } from '@/lib/badges/load';

const STATE_LABEL: Record<BadgeView['state'], string> = {
  in_wallet: 'In your wallet',
  minted: 'Minted',
  pending: 'Minting soon',
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The viewer's soulbound survivor badges, each with its on-chain proof. */
export function BadgeGallery({ badges }: { badges: BadgeView[] }) {
  if (!badges.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No badges yet. Keep your streak every day of a challenge and a soulbound badge is minted to your wallet after it settles.{' '}
          <Link className="underline underline-offset-4" href="/challenges">
            Find a challenge
          </Link>
          .
        </CardContent>
      </Card>
    );
  }
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2">
      {badges.map((b) => (
        <StaggerItem key={`${b.challengeAddress}-${b.wallet}`}>
          <Card className="h-full overflow-hidden">
            {b.imageUrl && (
              // A plain <img>: the SVG is served by our own API with a strict CSP.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.imageUrl} alt={b.name} width={512} height={512} className={`aspect-square w-full bg-muted ${b.state === 'pending' ? 'opacity-40 grayscale' : ''}`} />
            )}
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{b.name}</CardTitle>
                <Badge variant={b.state === 'in_wallet' ? 'success' : b.state === 'minted' ? 'primary' : 'outline'}>{STATE_LABEL[b.state]}</Badge>
              </div>
              <CardDescription>
                {b.challengeAddress ? (
                  <Link className="underline underline-offset-4" href={`/challenges/${b.challengeAddress}`}>
                    {b.challengeTitle}
                  </Link>
                ) : (
                  b.challengeTitle
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {b.state === 'pending' ? (
                <p className="text-muted-foreground">You survived. The badge is minted to {short(b.wallet)} a few minutes after the challenge settles.</p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Soulbound Token-2022 in {short(b.wallet)}. It cannot be transferred or sold: the token program refuses any transfer.
                  </p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {b.mintUrl && (
                      <li>
                        <a className="underline underline-offset-4" href={b.mintUrl} target="_blank" rel="noreferrer">
                          Token on Explorer ↗
                        </a>
                      </li>
                    )}
                    {b.txUrl && (
                      <li>
                        <a className="underline underline-offset-4" href={b.txUrl} target="_blank" rel="noreferrer">
                          Mint transaction ↗
                        </a>
                      </li>
                    )}
                    {b.metadataUrl && (
                      <li>
                        <a className="underline underline-offset-4" href={b.metadataUrl} target="_blank" rel="noreferrer">
                          Metadata
                        </a>
                      </li>
                    )}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
