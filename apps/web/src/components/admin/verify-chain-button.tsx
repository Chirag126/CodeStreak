'use client';

import { useState, useTransition } from 'react';
import { verifyAuditChainAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';

/** Recomputes every audit hash on the server and reports whether the chain is intact. */
export function VerifyChainButton() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" loading={busy} onClick={() => start(async () => {
        const r = await verifyAuditChainAction();
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      })}>
        Verify hash chain
      </Button>
      {msg && <span className={`text-sm ${msg.ok ? 'text-success' : 'text-destructive-text'}`}>{msg.text}</span>}
    </div>
  );
}
