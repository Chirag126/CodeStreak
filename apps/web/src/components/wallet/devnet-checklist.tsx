import { CheckCircle2, Circle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  walletFound: boolean;
  walletLinked: boolean;
  devnetReady: boolean | null;
  hasSol: boolean;
  hasUsdc: boolean;
}

/** Steps to be ready to stake on devnet, ticked from what the page can actually see. */
export function DevnetChecklist({ walletFound, walletLinked, devnetReady, hasSol, hasUsdc }: Props) {
  const steps = [
    { done: walletFound, title: 'Install Phantom', body: 'Or use MetaMask with a Solana account.', href: 'https://phantom.com/download' },
    {
      done: Boolean(devnetReady),
      title: 'Switch the wallet to devnet',
      body: 'Phantom: Settings → Developer settings → Testnet mode → Solana Devnet.',
    },
    { done: walletLinked, title: 'Link your wallet', body: 'Sign one free message above.' },
    { done: hasSol, title: 'Get devnet SOL', body: 'For network fees. Free from the Solana faucet.', href: 'https://faucet.solana.com' },
    { done: hasUsdc, title: 'Get devnet USDC', body: 'To stake. Free from Circle (choose Solana Devnet).', href: 'https://faucet.circle.com' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devnet setup</CardTitle>
        <CardDescription>
          {doneCount} of {steps.length} done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex gap-3">
              {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />}
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {s.href ? (
                    <a className="underline-offset-4 hover:underline" href={s.href} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
