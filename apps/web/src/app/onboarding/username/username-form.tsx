'use client';

import { normalizeUsername } from '@codestreak/shared';
import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { claimUsername, isUsernameAvailable, type UsernameState } from './actions';

export function UsernameForm({ next }: { next: string }) {
  const [state, submit, saving] = useActionState(claimUsername, {} as UsernameState);
  const [value, setValue] = useState(state.value ?? '');
  const [hint, setHint] = useState<{ ok: boolean; message: string } | null>(null);

  // Debounced availability check (best effort; saving re-checks in the database).
  useEffect(() => {
    const name = normalizeUsername(value);
    if (name.length < 3) {
      setHint(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void isUsernameAvailable(name).then((r) => !cancelled && setHint(r));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const error = state.error;
  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={Boolean(error) || (hint ? !hint.ok : undefined)}
          aria-describedby="username-help"
        />
        <p id="username-help" className="text-xs text-muted-foreground">
          3–20 characters: lowercase letters, numbers and underscores.
        </p>
        {hint && !error && (
          <p role="status" className={hint.ok ? 'text-sm text-success' : 'text-sm text-destructive-text'}>
            {hint.message}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={saving}>
        Continue
      </Button>
    </form>
  );
}
