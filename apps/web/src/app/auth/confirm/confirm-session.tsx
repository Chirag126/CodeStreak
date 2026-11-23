'use client';

import type { EmailOtpType } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorMessage, parseAuthFragment } from '@/lib/auth/fragment';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const OTP_TYPES: ReadonlySet<string> = new Set(['email', 'magiclink', 'signup']);

/**
 * Finishes sign-in from the email link. Two kinds of link land here:
 *
 * - `?token_hash=&type=` (custom email template, needs custom SMTP): nothing is used up until the
 *   person presses "Continue". Link previews and mail scanners (WhatsApp, Slack, Outlook Safe Links)
 *   fetch the page but never press the button, so they can't spend the one-time link.
 * - `#access_token=` (Supabase's default template): Supabase already used the link before this page
 *   loaded; the tokens arrive in the fragment (never sent to any server) and become the session.
 *
 * Then the fragment / token is removed from history and the route guard sends new users to the
 * username step and everyone else to `next`.
 */
export function ConfirmSession({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ tokenHash: string; type: EmailOtpType } | null>(null);
  const [busy, setBusy] = useState(false);
  const done = () => window.location.replace(`/sign-in?next=${encodeURIComponent(next)}`);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get('token_hash');
    const type = query.get('type');
    const fragment = parseAuthFragment(window.location.hash);
    window.history.replaceState(null, '', `${window.location.pathname}?next=${encodeURIComponent(next)}`);
    const supabase = createSupabaseBrowserClient();
    // A link opened a second time is "expired" (links work once), but if this browser is already
    // signed in, that is not a problem: just continue.
    const alreadySignedIn = () => supabase.auth.getSession().then(({ data }) => Boolean(data.session));

    if (tokenHash && type && OTP_TYPES.has(type)) {
      void alreadySignedIn().then((signedIn) => (signedIn ? done() : setPending({ tokenHash, type: type as EmailOtpType })));
      return;
    }
    const outcome: Promise<string | null> =
      fragment.kind === 'session'
        ? supabase.auth
            .setSession({ access_token: fragment.accessToken, refresh_token: fragment.refreshToken })
            .then(({ error: e }) => (e ? authErrorMessage('invalid') : null))
        : alreadySignedIn().then((signedIn) =>
            signedIn ? null : fragment.kind === 'error' ? authErrorMessage(fragment.code) : 'This page needs the link from your sign-in email. Request a new one.',
          );
    void outcome.then((message) => (message ? setError(message) : done()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const { error: e } = await createSupabaseBrowserClient().auth.verifyOtp({ token_hash: pending.tokenHash, type: pending.type });
    if (e) {
      setBusy(false);
      setPending(null);
      setError(authErrorMessage(/expired|invalid/i.test(e.message) ? 'otp_expired' : 'invalid'));
      return;
    }
    done();
  }

  if (pending) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Press continue to finish signing in on this device.</p>
        <Button onClick={confirm} loading={busy} className="w-full">
          Continue to CodeStreak
        </Button>
      </div>
    );
  }
  if (!error) return <p className="text-sm text-muted-foreground" role="status">Signing you in…</p>;
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive-text">
        {error}
      </p>
      <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(next)}`}>
        Back to sign in
      </a>
    </div>
  );
}
