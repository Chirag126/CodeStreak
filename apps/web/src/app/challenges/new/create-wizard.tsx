'use client';

import { DEMO_DAY_MINUTES, GITHUB_OPTION_LIMITS, STAKE_LIMITS, validateChallengeForm, type ChallengeFormInput } from '@codestreak/shared';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { TxFlowError, useTxFlow } from '@/components/tx/tx-flow';
import { explorerTxUrl, TxStepper } from '@/components/tx/tx-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';
import { variants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { prepareCreateAction, submitCreateAction } from './actions';

type Form = Required<Omit<ChallengeFormInput, 'startDate'>> & { startDate?: string };

const STEPS = [
  { title: 'Basics', fields: ['title', 'description', 'visibility'] },
  { title: 'Stake', fields: ['token', 'buyIn'] },
  { title: 'Schedule', fields: ['mode', 'durationDays', 'startDate', 'demoDayMinutes', 'demoStartMinutes'] },
  { title: 'Rules', fields: ['providers', 'providerRule', 'minLines', 'githubFileTypes', 'allowDocs', 'allowGenerated', 'allowForks', 'backdateHours'] },
  { title: 'Players & Shields', fields: ['minPlayers', 'maxPlayers', 'shieldsEnabled', 'shieldPrice', 'maxShields', 'shieldGraceMinutes'] },
  { title: 'Review', fields: [] as string[] },
] as const;

function tomorrowUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const INITIAL: Form = {
  title: '',
  description: '',
  visibility: 'public',
  token: 'usdc',
  buyIn: '5',
  mode: 'real',
  durationDays: 7,
  startDate: tomorrowUtc(),
  demoDayMinutes: 5,
  demoStartMinutes: 15,
  providers: ['github'],
  providerRule: 'any',
  minLines: 15,
  githubFileTypes: '',
  allowDocs: false,
  allowGenerated: false,
  allowForks: false,
  backdateHours: 0,
  minPlayers: 2,
  maxPlayers: 50,
  shieldsEnabled: true,
  shieldPrice: '1',
  maxShields: 1,
  shieldGraceMinutes: 120,
};

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            value === o.value ? 'border-cobalt-400 bg-cobalt-400/10' : 'border-border hover:bg-muted',
          )}
        >
          <span className="block text-sm font-medium">{o.label}</span>
          {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Current unix time; read in event handlers only (never during render). */
const nowSecs = () => Math.floor(Date.now() / 1000);

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

export function CreateWizard({ linkedWallets }: { linkedWallets: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  const [form, setForm] = useState<Form>(INITIAL);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { state, run } = useTxFlow();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const symbol = STAKE_LIMITS[form.token].symbol;

  /** Client-side validation with the same rules the server and program use. */
  function errorsFor(fields: readonly string[]): Record<string, string> {
    const r = validateChallengeForm(form, nowSecs());
    if (r.ok) return {};
    return Object.fromEntries(Object.entries(r.errors).filter(([k]) => fields.length === 0 || fields.includes(k)));
  }

  function next() {
    const e = errorsFor(STEPS[step]!.fields);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function jumpToFirstError(all: Record<string, string>) {
    setErrors(all);
    const index = STEPS.findIndex((s) => s.fields.some((f) => f in all));
    if (index >= 0) setStep(index);
  }

  async function create(wallet: Wallet) {
    const all = errorsFor([]);
    if (Object.keys(all).length) return jumpToFirstError(all);

    const result = await run(async ({ step: progress }) => {
      const account = await connectWallet(wallet);
      if (!linkedWallets.includes(account.address)) {
        throw new TxFlowError({ code: 'wallet.not_linked', title: 'Wrong wallet', message: 'Switch to your linked wallet (Dashboard → Wallet) and try again.' });
      }
      const prepared = await prepareCreateAction({ form, wallet: account.address, idempotencyKey });
      if (!prepared.ok) {
        if (prepared.fieldErrors) jumpToFirstError(prepared.fieldErrors);
        throw new TxFlowError({ code: prepared.code ?? 'relayer.refused', title: prepared.title ?? 'Could not prepare the challenge', message: prepared.error });
      }
      if ('signature' in prepared) return `${prepared.signature}|${prepared.challenge}`;

      progress('sign');
      const feature = wallet.features['solana:signTransaction'] as SignTransactionFeature;
      const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
      if (!out) throw new TxFlowError({ code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'The wallet returned no signature.' });

      progress('confirm');
      const submitted = await submitCreateAction({ idempotencyKey, signedTransaction: toBase64(out.signedTransaction) });
      if (!submitted.ok) throw new TxFlowError({ code: submitted.code ?? 'relayer.refused', title: submitted.title ?? 'Creation did not go through', message: submitted.error });
      return `${submitted.signature}|${prepared.challenge}`;
    });

    if (result.ok) {
      const [signature, challenge] = result.signature.split('|') as [string, string];
      toast({ kind: 'success', title: 'Challenge created', message: 'Your pool and vault are live on devnet.', href: explorerTxUrl(signature), hrefLabel: 'View on Explorer' });
      router.push(`/challenges/${challenge}`);
    } else {
      toast({ kind: 'error', title: result.error.title, message: result.error.message });
    }
  }

  const stepState = state.status === 'success' ? { ...state, signature: state.signature?.split('|')[0] } : state;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                i === step ? 'border-cobalt-400 text-foreground' : i < step ? 'border-electric-400/40 text-success' : 'border-border text-muted-foreground',
              )}
            >
              {i + 1}. {s.title}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]!.title}</CardTitle>
          <CardDescription>
            Step {step + 1} of {STEPS.length}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} variants={variants.fadeUp} initial="hidden" animate="show" exit="hidden" className="space-y-5">
              {step === 0 && (
                <>
                  <Field label="Title" htmlFor="title" error={errors.title}>
                    <Input id="title" value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="7-day shipping sprint" />
                  </Field>
                  <Field label="Description (optional)" htmlFor="description" error={errors.description}>
                    <textarea
                      id="description"
                      value={form.description}
                      maxLength={1000}
                      rows={3}
                      onChange={(e) => set('description', e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    />
                  </Field>
                  <Field label="Who can join" error={errors.visibility}>
                    <Choice
                      label="Visibility"
                      value={form.visibility}
                      onChange={(v) => set('visibility', v)}
                      options={[
                        { value: 'public', label: 'Public', hint: 'Anyone can find and join it' },
                        { value: 'private', label: 'Private group', hint: 'Only people you invite' },
                      ]}
                    />
                  </Field>
                </>
              )}

              {step === 1 && (
                <>
                  <Field label="Token" error={errors.token}>
                    <Choice
                      label="Token"
                      value={form.token}
                      onChange={(v) => setForm((f) => ({ ...f, token: v, buyIn: v === 'sol' ? '0.1' : '5', shieldPrice: v === 'sol' ? '0.02' : '1' }))}
                      options={[
                        { value: 'usdc', label: 'USDC', hint: 'Devnet USDC' },
                        { value: 'sol', label: 'SOL', hint: 'Staked as wrapped SOL' },
                      ]}
                    />
                  </Field>
                  <Field label={`Buy-in (${symbol})`} htmlFor="buyIn" error={errors.buyIn} hint={`Between ${STAKE_LIMITS[form.token].min} and ${STAKE_LIMITS[form.token].max} ${symbol}. Devnet tokens only.`}>
                    <Input id="buyIn" inputMode="decimal" value={form.buyIn} onChange={(e) => set('buyIn', e.target.value)} />
                  </Field>
                </>
              )}

              {step === 2 && (
                <>
                  <Field label="Mode" error={errors.mode}>
                    <Choice
                      label="Mode"
                      value={form.mode}
                      onChange={(v) => set('mode', v)}
                      options={[
                        { value: 'real', label: 'Real time', hint: 'One day = 24 hours' },
                        { value: 'demo', label: 'Demo mode', hint: 'Compressed days, for trying it out' },
                      ]}
                    />
                  </Field>
                  {form.mode === 'real' ? (
                    <>
                      <Field label="Length" error={errors.durationDays}>
                        <Choice label="Length" value={form.durationDays} onChange={(v) => set('durationDays', v)} options={[3, 7, 14, 30].map((d) => ({ value: d as 3 | 7 | 14 | 30, label: `${d} days` }))} />
                      </Field>
                      <Field label="Start date (UTC)" htmlFor="startDate" error={errors.startDate} hint="Day 1 starts at 00:00 UTC on this date. Joining closes then.">
                        <Input id="startDate" type="date" min={tomorrowUtc()} value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Day length" error={errors.demoDayMinutes} hint="3 compressed days. Clearly labeled DEMO everywhere.">
                        <Choice label="Day length" value={form.demoDayMinutes} onChange={(v) => set('demoDayMinutes', v)} options={DEMO_DAY_MINUTES.map((m) => ({ value: m, label: `${m} minutes` }))} />
                      </Field>
                      <Field label="Starts in (minutes)" htmlFor="demoStart" error={errors.demoStartMinutes} hint="10 to 120 minutes from now.">
                        <Input id="demoStart" type="number" min={10} max={120} value={Number.isNaN(form.demoStartMinutes) ? '' : form.demoStartMinutes} onChange={(e) => set('demoStartMinutes', num(e.target.value))} />
                      </Field>
                    </>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <Field label="What counts as a day's work" error={errors.providers}>
                    <div className="flex flex-wrap gap-4">
                      {(['github', 'leetcode'] as const).map((p) => (
                        <label key={p} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--color-cobalt-400)]"
                            checked={form.providers.includes(p)}
                            onChange={(e) => set('providers', e.target.checked ? [...form.providers, p] : form.providers.filter((x) => x !== p))}
                          />
                          {p === 'github' ? 'GitHub pushes' : 'LeetCode accepted solutions'}
                        </label>
                      ))}
                    </div>
                  </Field>
                  {form.providers.length > 1 && (
                    <Field label="Combine them" error={errors.providerRule}>
                      <Choice
                        label="Combine providers"
                        value={form.providerRule}
                        onChange={(v) => set('providerRule', v)}
                        options={[
                          { value: 'any', label: 'ANY', hint: 'Either one counts' },
                          { value: 'all', label: 'ALL', hint: 'Both every day' },
                        ]}
                      />
                    </Field>
                  )}
                  {form.providers.includes('github') && (
                    <Field label="Minimum meaningful lines per day" htmlFor="minLines" error={errors.minLines} hint="Added + changed code lines in your own repos (not forks).">
                      <Input id="minLines" type="number" min={1} max={500} value={Number.isNaN(form.minLines) ? '' : form.minLines} onChange={(e) => set('minLines', num(e.target.value))} />
                    </Field>
                  )}
                  {form.providers.includes('github') && (
                    <details className="rounded-lg border border-border p-4">
                      <summary className="cursor-pointer text-sm font-medium">GitHub options (strict by default)</summary>
                      <div className="mt-4 space-y-4">
                        <Field
                          label="Only these file types (optional)"
                          htmlFor="githubFileTypes"
                          error={errors.githubFileTypes}
                          hint="Extensions like .ts .py and/or exact file names like main.py. Empty = all source files."
                        >
                          <Input id="githubFileTypes" value={form.githubFileTypes} onChange={(e) => set('githubFileTypes', e.target.value)} placeholder=".ts .tsx main.py" spellCheck={false} />
                        </Field>
                        <p className="text-xs text-muted-foreground">
                          Never counted: whitespace-only or re-indented changes, moved lines, and the same change pushed again (rebase, cherry-pick). Counting them would let anyone farm lines.
                        </p>
                        <div className="space-y-2">
                          {(
                            [
                              ['allowDocs', `Count README and docs (at most ${Math.floor(form.minLines * GITHUB_OPTION_LIMITS.docsCapShare) || 0} of the ${form.minLines || 0} lines)`],
                              ['allowGenerated', `Count lockfiles, minified and generated files (at most ${Math.floor(form.minLines * GITHUB_OPTION_LIMITS.generatedCapShare) || 0} lines)`],
                              ['allowForks', 'Count your own commits in your forks'],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} className="flex items-start gap-2 text-sm">
                              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-cobalt-400)]" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
                              {label}
                            </label>
                          ))}
                        </div>
                        <Field
                          label="Backdated commits: allow commits made up to this many hours before the day starts"
                          htmlFor="backdateHours"
                          error={errors.backdateHours}
                          hint={`0 = only commits made during the day (strict). At most ${GITHUB_OPTION_LIMITS.maxBackdateHours}.`}
                        >
                          <Input id="backdateHours" type="number" min={0} max={GITHUB_OPTION_LIMITS.maxBackdateHours} value={Number.isNaN(form.backdateHours) ? '' : form.backdateHours} onChange={(e) => set('backdateHours', num(e.target.value))} />
                        </Field>
                      </div>
                    </details>
                  )}
                </>
              )}

              {step === 4 && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Minimum players" htmlFor="minPlayers" error={errors.minPlayers} hint="If fewer join, everyone is refunded.">
                      <Input id="minPlayers" type="number" min={2} value={Number.isNaN(form.minPlayers) ? '' : form.minPlayers} onChange={(e) => set('minPlayers', num(e.target.value))} />
                    </Field>
                    <Field label="Maximum players" htmlFor="maxPlayers" error={errors.maxPlayers}>
                      <Input id="maxPlayers" type="number" max={1000} value={Number.isNaN(form.maxPlayers) ? '' : form.maxPlayers} onChange={(e) => set('maxPlayers', num(e.target.value))} />
                    </Field>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch id="shields" checked={form.shieldsEnabled} onCheckedChange={(v) => set('shieldsEnabled', v)} />
                    <Label htmlFor="shields">Streak Shields (players can pay to protect a missed day)</Label>
                  </div>
                  {form.shieldsEnabled && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label={`Price (${symbol})`} htmlFor="shieldPrice" error={errors.shieldPrice} hint="Goes to the reward pool.">
                        <Input id="shieldPrice" inputMode="decimal" value={form.shieldPrice} onChange={(e) => set('shieldPrice', e.target.value)} />
                      </Field>
                      <Field label="Per player" htmlFor="maxShields" error={errors.maxShields} hint="1 to 3">
                        <Input id="maxShields" type="number" min={1} max={3} value={Number.isNaN(form.maxShields) ? '' : form.maxShields} onChange={(e) => set('maxShields', num(e.target.value))} />
                      </Field>
                      <Field label="Grace (minutes)" htmlFor="grace" error={errors.shieldGraceMinutes} hint="After a day ends">
                        <Input id="grace" type="number" min={1} value={Number.isNaN(form.shieldGraceMinutes) ? '' : form.shieldGraceMinutes} onChange={(e) => set('shieldGraceMinutes', num(e.target.value))} />
                      </Field>
                    </div>
                  )}
                </>
              )}

              {step === 5 && (
                <>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Title</dt><dd>{form.title}</dd></div>
                    <div>
                      <dt className="text-muted-foreground">Visibility</dt>
                      <dd>{form.visibility === 'private' ? 'Private group (invite only)' : 'Public'}</dd>
                    </div>
                    <div><dt className="text-muted-foreground">Buy-in</dt><dd className="font-mono">{form.buyIn} {symbol}</dd></div>
                    <div>
                      <dt className="text-muted-foreground">Schedule</dt>
                      <dd>
                        {form.mode === 'demo' ? (
                          <span className="flex items-center gap-2">
                            <Badge variant="warning">DEMO</Badge> 3 days × {form.demoDayMinutes} min, starts in {form.demoStartMinutes} min
                          </span>
                        ) : (
                          `${form.durationDays} days from ${form.startDate} (UTC)`
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Counts</dt>
                      <dd>
                        {form.providers.map((p) => (p === 'github' ? `GitHub (≥ ${form.minLines} lines)` : 'LeetCode (1 accepted)')).join(form.providerRule === 'all' ? ' AND ' : ' OR ')}
                      </dd>
                    </div>
                    <div><dt className="text-muted-foreground">Players</dt><dd>{form.minPlayers} to {form.maxPlayers}</dd></div>
                    <div>
                      <dt className="text-muted-foreground">Shields</dt>
                      <dd>{form.shieldsEnabled ? `${form.maxShields} × ${form.shieldPrice} ${symbol}, ${form.shieldGraceMinutes} min grace` : 'Off'}</dd>
                    </div>
                  </dl>
                  {linkedWallets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Link a wallet first (Dashboard → Wallet). It becomes the challenge creator.</p>
                  ) : wallets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {wallets.map((w) => (
                        <Button key={w.name} onClick={() => void create(w)} loading={state.status === 'running'} disabled={state.status === 'success'}>
                          Create with {w.name}
                        </Button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">CodeStreak pays the network fees and account rent. You only approve in your wallet; no stake is taken when creating.</p>
                  <TxStepper state={stepState} />
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || state.status === 'running'}>
              Back
            </Button>
            {step < STEPS.length - 1 && <Button onClick={next}>Next</Button>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
