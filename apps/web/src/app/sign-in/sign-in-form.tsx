'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { variants } from '@/lib/motion';
import { requestCode, verifyCode, type SignInState } from './actions';

export function SignInForm({ next }: { next: string }) {
  const [emailState, sendCode, sending] = useActionState(requestCode, { step: 'email' } as SignInState);
  const [codeState, checkCode, checking] = useActionState(verifyCode, { step: 'email' } as SignInState);

  // The code form appears once a code was sent; a failed verification keeps it open with its error.
  const codeEmail = codeState.step === 'code' ? codeState.email : emailState.step === 'code' ? emailState.email : null;
  const error = codeEmail ? (codeState.step === 'code' ? codeState.error : undefined) : emailState.error;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!codeEmail ? (
        <motion.form key="email" action={sendCode} className="space-y-4" variants={variants.fadeUp} initial="hidden" animate="show" exit="hidden">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={emailState.step === 'email' ? emailState.email : undefined}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'sign-in-error' : undefined}
            />
          </div>
          {error && (
            <p id="sign-in-error" role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={sending}>
            Email me a code
          </Button>
          <p className="text-xs text-muted-foreground">No password. New here? The code creates your account.</p>
        </motion.form>
      ) : (
        <motion.form key="code" action={checkCode} className="space-y-4" variants={variants.fadeUp} initial="hidden" animate="show" exit="hidden">
          <input type="hidden" name="email" value={codeEmail} />
          <input type="hidden" name="next" value={next} />
          <p className="text-sm text-muted-foreground" role="status">
            {emailState.step === 'code' ? emailState.notice : `We sent a code to ${codeEmail}.`}
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
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
          {error && (
            <p id="code-error" role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={checking}>
            Verify and continue
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => window.location.reload()}>
            Use a different email
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
