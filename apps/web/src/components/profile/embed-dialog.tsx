'use client';

import { widgetSnippets, WIDGET_SIZE, type WidgetTheme } from '@codestreak/shared';
import { Check, Code2, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            )
          }
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-xs leading-relaxed whitespace-pre-wrap break-all">{value}</pre>
    </div>
  );
}

/** Phase 38: preview and paste-ready code for the profile widget (iframe, image, Markdown). */
export function EmbedDialog({ username }: { username: string }) {
  const [theme, setTheme] = useState<WidgetTheme>('dark');
  const [origin, setOrigin] = useState('');
  const s = origin ? widgetSnippets(origin, username, theme) : null;
  return (
    <Dialog onOpenChange={(open) => open && setOrigin(window.location.origin)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Code2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Embed</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Embed @{username}</DialogTitle>
          <DialogDescription>A live card for a README, blog or portfolio. It updates on its own (within about 10 minutes).</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" role="radiogroup" aria-label="Theme">
          {(['dark', 'light'] as const).map((t) => (
            <Button key={t} size="sm" variant={theme === t ? 'secondary' : 'ghost'} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className="capitalize">
              {t}
            </Button>
          ))}
        </div>
        {s && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the widget itself, as others will see it */}
            <img src={s.svg} alt={`${username} on CodeStreak`} width={WIDGET_SIZE.width} height={WIDGET_SIZE.height} className="h-auto w-full max-w-[480px] rounded-xl" />
            <CopyRow label="Markdown (GitHub README)" value={s.markdown} />
            <CopyRow label="HTML image" value={s.html} />
            <CopyRow label="HTML iframe" value={s.iframe} />
            <div className="flex flex-wrap gap-2 pt-1 text-sm">
              <a className="underline underline-offset-4" href={s.svg} target="_blank" rel="noreferrer">
                SVG
              </a>
              <a className="underline underline-offset-4" href={s.png} target="_blank" rel="noreferrer">
                PNG
              </a>
              <a className="underline underline-offset-4" href={s.jpg} target="_blank" rel="noreferrer">
                JPG
              </a>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
