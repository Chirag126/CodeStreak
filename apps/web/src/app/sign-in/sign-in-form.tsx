'use client';

import { formatWait } from '@codestreak/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { variants } from '@/lib/motion';
import { requestCode, verifyCode, type SignInState } from './actions';
import { useCountdown } from './use-countdown';

export function SignInForm({ next, linkError, hideError, onEmailStart }: { next: string; linkError?: boolean; hideError?: boolean; onEmailStart?: () => void }) {
  const [emailState, sendCode, sending] = useActionState(requestCode, { step: 'email' } as SignInState);
  const [codeState, checkCode, checking] = useActionState(verifyCode, { step: 'email' } as SignInState);

  // The code form appears once a code was sent; a failed verification keeps it open with its error.
  const codeEmail = codeState.step === 'code' ? codeState.email : emailState.step === 'code' ? emailState.email : null;
  const error = codeEmail
    ? codeState.step === 'code'
      ? codeState.error
      : undefined
    : (emailState.error ?? (linkError ? 'That sign-in link did not work. Request a new one: it opens in any browser now.' : undefined));

  // "3 tries, then wait": the server sends `retryAt`; the button stays off with a countdown.
  const sendWait = useCountdown(emailState.retryAt);
  const codeWait = useCountdown(codeState.step === 'code' ? codeState.retryAt : undefined);
  const waiting = codeEmail ? codeWait : sendWait;
  const shownError = hideError ? undefined : waiting > 0 || !(codeEmail ? codeState.retryAt : emailState.retryAt) ? error : undefined;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!codeEmail ? (
        <motion.form key="email" action={sendCode} onSubmit={onEmailStart} className="space-y-4" variants={variants.fadeUp} initial="hidden" animate="show" exit="hidden">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={emailState.step === 'email' ? emailState.email : undefined}
              aria-invalid={Boolean(shownError) || undefined}
              aria-describedby={shownError ? 'sign-in-error' : undefined}
            />
          </div>
          {shownError && (
            <p id="sign-in-error" role="alert" className="text-sm text-destructive-text">
              {shownError}
            </p>
          )}
          <Button type="submit" className="w-full" loading={sending} disabled={sendWait > 0}>
            {sendWait > 0 ? `Try again in ${formatWait(sendWait)}` : 'Email me a sign-in link'}
          </Button>
          <p className="text-xs text-muted-foreground">No password. New here? The link creates your account.</p>
        </motion.form>
      ) : (
        <motion.form key="code" action={checkCode} className="space-y-4" variants={variants.fadeUp} initial="hidden" animate="show" exit="hidden">
          <input type="hidden" name="email" value={codeEmail} />
          <input type="hidden" name="next" value={next} />
          <p className="text-sm text-muted-foreground" role="status">
            {emailState.step === 'code' ? emailState.notice : `Check ${codeEmail} for your sign-in email.`}
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Code (only if your email shows one)</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6,10}"
              maxLength={10}
              required
              autoFocus
              className="font-mono tracking-[0.3em]"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'code-error' : undefined}
            />
          </div>
          {shownError && (
            <p id="code-error" role="alert" className="text-sm text-destructive-text">
              {shownError}
            </p>
          )}
          <Button type="submit" className="w-full" loading={checking} disabled={codeWait > 0}>
            {codeWait > 0 ? `Try again in ${formatWait(codeWait)}` : 'Verify and continue'}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => window.location.reload()}>
            Use a different email
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
