'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { submitAppealAction } from './actions';

export function AppealForm() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-2">
      <textarea
        className="h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder="Explain why the decision should change (10–2000 characters)."
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={text.trim().length < 10 || busy}
          loading={busy}
          onClick={() =>
            start(async () => {
              const r = await submitAppealAction(text);
              setMsg(r.ok ? { ok: true, text: 'Appeal sent. You will be notified of the decision.' } : { ok: false, text: r.error });
              if (r.ok) setText('');
            })
          }
        >
          Send appeal
        </Button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-success' : 'text-destructive-text'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
