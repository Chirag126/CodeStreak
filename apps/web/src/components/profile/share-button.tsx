'use client';

import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Copies the profile link (or opens the system share sheet where there is one). */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed, or clipboard blocked: nothing to do.
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void share()}>
      {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {copied ? 'Link copied' : 'Share profile'}
    </Button>
  );
}
