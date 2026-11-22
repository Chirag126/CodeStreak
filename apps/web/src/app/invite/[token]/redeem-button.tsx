'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { redeemAction } from './actions';

export function RedeemButton({ token }: { token: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        loading={busy}
        onClick={() =>
          start(async () => {
            const r = await redeemAction(token);
            if (r?.error) setError(r.error);
          })
        }
      >
        Accept invitation
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
