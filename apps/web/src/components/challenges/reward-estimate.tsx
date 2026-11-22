'use client';

import { estimateReward } from '@codestreak/shared';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { money, type Token } from './format';

/**
 * "If you keep your streak": the program's settlement formula applied to this pool, for a survival
 * rate the viewer picks. An estimate: the real split is computed by the program at settlement.
 */
export function RewardEstimate(props: { token: Token; buyIn: string; participants: number; totalSponsor: string; totalShield: string; includeViewer: boolean; initialRate: number }) {
  const [rate, setRate] = useState(props.initialRate);
  const e = estimateReward({
    buyIn: BigInt(props.buyIn),
    participants: props.participants,
    totalSponsor: BigInt(props.totalSponsor),
    totalShield: BigInt(props.totalShield),
    survivalRate: rate / 100,
    includeViewer: props.includeViewer,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="survival">
          If <span className="font-mono">{rate}%</span> of players keep their streak
        </Label>
        <input
          id="survival"
          type="range"
          min={0}
          max={100}
          step={5}
          value={rate}
          onChange={(ev) => setRate(Number(ev.target.value))}
          className="w-full accent-[var(--color-cobalt-400)]"
          aria-valuetext={`${rate} percent`}
        />
        <p className="text-xs text-muted-foreground">
          {e.participants} players{props.includeViewer ? ' (including you)' : ''}: {e.survivors} survive, {e.failed} miss a day.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Reward pool (R)</dt>
        <dd className="text-right font-mono">{money(e.rewardPool, props.token)}</dd>
        <dt className="text-muted-foreground">Each survivor gets</dt>
        <dd className="text-right font-mono">{e.fullRefund ? 'full refund' : money(e.survivorPayout, props.token)}</dd>
        <dt className="text-muted-foreground">Profit if you survive</dt>
        <dd className="text-right font-mono text-success">+{money(e.profit, props.token)}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Estimate only, using today&apos;s pool. More players, sponsors and Shields change it; the program computes the real split at settlement.
      </p>
    </div>
  );
}
