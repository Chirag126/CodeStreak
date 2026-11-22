'use client';

import { useEffect, useState } from 'react';
import { authErrorMessage, parseAuthFragment } from '@/lib/auth/fragment';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Finishes sign-in from the email link: the tokens arrive in the URL fragment (never sent to any
 * server), are stored as the session cookie, and then the fragment is removed from history. The
 * route guard then sends new users to the username step and everyone else to `next`.
 */
export function ConfirmSession({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragment = parseAuthFragment(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const supabase = createSupabaseBrowserClient();
    // A link opened a second time is "expired" (links work once), but if this browser is already
    // signed in, that is not a problem: just continue.
    const alreadySignedIn = () => supabase.auth.getSession().then(({ data }) => Boolean(data.session));
    const outcome: Promise<string | null> =
      fragment.kind === 'session'
        ? supabase.auth
            .setSession({ access_token: fragment.accessToken, refresh_token: fragment.refreshToken })
            .then(({ error: e }) => (e ? authErrorMessage('invalid') : null))
        : alreadySignedIn().then((signedIn) =>
            signedIn ? null : fragment.kind === 'error' ? authErrorMessage(fragment.code) : 'This page needs the link from your sign-in email. Request a new one.',
          );
    void outcome.then((message) => {
      if (message) setError(message);
      else window.location.replace(`/sign-in?next=${encodeURIComponent(next)}`);
    });
  }, [next]);

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
