// Create-challenge rules, shared by the wizard (browser) and the server action. `toPoolParams`
// turns a valid form into the program's InitializePoolParams; `validatePoolParams` is a line-by-
// line mirror of programs/codestreak/src/validation.rs, so nothing the wizard accepts can be
// refused on-chain.
import { z } from 'zod';

import { GITHUB_OPTION_LIMITS, SOL_DECIMALS, USDC_DECIMALS } from './constants.js';
import { parseAmount } from './money.js';

export const PROGRAM_LIMITS = {
  minDayLengthSecs: 60,
  secondsPerDay: 86_400,
  maxNumDays: 60,
  minParticipants: 2,
  maxParticipants: 1_000,
  minWindowSecs: 60,
  maxWindowSecs: 7 * 86_400,
  maxStartDelaySecs: 90 * 86_400,
  maxShields: 3,
} as const;

/** Product limits (stricter than the program): sensible stakes for a devnet accountability app. */
export const STAKE_LIMITS = {
  usdc: { decimals: USDC_DECIMALS, min: '1', max: '1000', symbol: 'USDC' },
  sol: { decimals: SOL_DECIMALS, min: '0.01', max: '10', symbol: 'SOL' },
} as const;

export const DEMO_DAY_MINUTES = [2, 5, 10] as const;
export const DEMO_NUM_DAYS = 3;
const REAL_VERIFY_WINDOW = 6 * 3600;
const REAL_DISPUTE_WINDOW = 24 * 3600;
const DEMO_VERIFY_WINDOW = 10 * 60;
const DEMO_DISPUTE_WINDOW = 15 * 60;

function amountUnits(text: string, decimals: number): bigint | null {
  try {
    return parseAmount(text.trim(), decimals);
  } catch {
    return null;
  }
}

export const challengeFormSchema = z
  .object({
    title: z.string().trim().min(3, 'At least 3 characters.').max(80, 'At most 80 characters.'),
    description: z.string().trim().max(1000, 'At most 1000 characters.').default(''),
    visibility: z.enum(['public', 'private']),
    token: z.enum(['usdc', 'sol']),
    buyIn: z.string(),
    mode: z.enum(['real', 'demo']),
    durationDays: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
    /** Real mode: the first day starts at 00:00 UTC on this date. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.').optional(),
    /** Demo mode: compressed days, starting this many minutes from now. */
    demoDayMinutes: z.union([z.literal(2), z.literal(5), z.literal(10)]).default(5),
    demoStartMinutes: z.number().int().min(10, 'At least 10 minutes from now.').max(120, 'At most 2 hours from now.').default(15),
    providers: z.array(z.enum(['github', 'leetcode'])).min(1, 'Choose at least one provider.').max(2),
    providerRule: z.enum(['any', 'all']),
    minLines: z.number().int().min(1, 'At least 1 line.').max(500, 'At most 500 lines.'),
    /** GitHub options (strict by default): file filter and capped allowances. */
    githubFileTypes: z.string().max(400, 'Too long.').default(''),
    /** Only pushes to these repositories count ("owner/name", resolved to ids on the server). */
    githubRepos: z.string().max(500, 'Too long.').default(''),
    allowDocs: z.boolean().default(false),
    /** LeetCode: new problems per day and minimum difficulty. */
    leetcodeMinSolves: z.number().int().min(1, 'At least 1 problem.').max(5, 'At most 5 problems.').default(1),
    leetcodeDifficulty: z.enum(['any', 'medium', 'hard']).default('any'),
    allowGenerated: z.boolean().default(false),
    allowForks: z.boolean().default(false),
    backdateHours: z.number().int().min(0, 'At least 0.').max(GITHUB_OPTION_LIMITS.maxBackdateHours, `At most ${GITHUB_OPTION_LIMITS.maxBackdateHours} hours.`).default(0),
    minPlayers: z.number().int().min(2, 'At least 2 players.').max(1000),
    maxPlayers: z.number().int().min(2).max(1000, 'At most 1000 players.'),
    shieldsEnabled: z.boolean(),
    shieldPrice: z.string().default(''),
    maxShields: z.number().int().min(1, 'At least 1.').max(3, 'At most 3.').default(1),
    shieldGraceMinutes: z.number().int().min(1, 'At least 1 minute.').max(1440).default(120),
  })
  .superRefine((f, ctx) => {
    const stake = STAKE_LIMITS[f.token];
    const buyIn = amountUnits(f.buyIn, stake.decimals);
    if (buyIn === null) {
      ctx.addIssue({ code: 'custom', path: ['buyIn'], message: `Enter an amount like ${stake.min}.` });
    } else if (buyIn < parseAmount(stake.min, stake.decimals) || buyIn > parseAmount(stake.max, stake.decimals)) {
      ctx.addIssue({ code: 'custom', path: ['buyIn'], message: `Between ${stake.min} and ${stake.max} ${stake.symbol}.` });
    }
    const filter = parseFileFilter(f.githubFileTypes);
    if (!filter.ok) ctx.addIssue({ code: 'custom', path: ['githubFileTypes'], message: filter.error });
    const repos = parseRepoList(f.githubRepos);
    if (!repos.ok) ctx.addIssue({ code: 'custom', path: ['githubRepos'], message: repos.error });
    if (f.mode === 'real' && !f.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Pick a start date.' });
    if (f.maxPlayers < f.minPlayers) ctx.addIssue({ code: 'custom', path: ['maxPlayers'], message: 'Must be at least the minimum.' });
    if (f.shieldsEnabled) {
      const price = amountUnits(f.shieldPrice, stake.decimals);
      if (price === null || price <= 0n) ctx.addIssue({ code: 'custom', path: ['shieldPrice'], message: 'Enter a Shield price above 0.' });
      else if (buyIn !== null && price > buyIn) ctx.addIssue({ code: 'custom', path: ['shieldPrice'], message: 'A Shield cannot cost more than the buy-in.' });
      const dayMinutes = f.mode === 'demo' ? f.demoDayMinutes : 1440;
      if (f.shieldGraceMinutes > dayMinutes) {
        ctx.addIssue({ code: 'custom', path: ['shieldGraceMinutes'], message: `At most ${dayMinutes} minutes (one day).` });
      }
    }
  });

export type ChallengeFormInput = z.input<typeof challengeFormSchema>;
export type ChallengeForm = z.output<typeof challengeFormSchema>;

export interface PoolParams {
  buyIn: bigint;
  startTs: number;
  dayLengthSecs: number;
  numDays: number;
  joinDeadlineTs: number;
  minParticipants: number;
  maxParticipants: number;
  shieldPrice: bigint;
  maxShieldsPerParticipant: number;
  shieldGraceSecs: number;
  verifyWindowSecs: number;
  disputeWindowSecs: number;
}

/**
 * "File types" input: extensions (".ts", "py") and/or exact file names ("main.py", "Makefile"),
 * separated by commas or spaces. Empty = every source file.
 */
export function parseFileFilter(raw: string): { ok: true; extensions: string[]; filenames: string[] } | { ok: false; error: string } {
  const entries = raw.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean);
  if (entries.length > GITHUB_OPTION_LIMITS.maxFilterEntries) return { ok: false, error: `At most ${GITHUB_OPTION_LIMITS.maxFilterEntries} entries.` };
  const extensions = new Set<string>();
  const filenames = new Set<string>();
  for (const e of entries) {
    // ".ts" or a short lowercase word ("py"): an extension.
    if (/^\.[A-Za-z0-9]{1,10}$/.test(e) || /^[a-z0-9]{1,10}$/.test(e)) extensions.add(`.${e.replace(/^\./, '').toLowerCase()}`);
    // "main.py", "Makefile", "Dockerfile.dev": an exact file name.
    else if (/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(e)) filenames.add(e);
    else return { ok: false, error: `"${e.slice(0, 20)}" is not a file extension (like .ts) or a file name (like main.py).` };
  }
  return { ok: true, extensions: [...extensions].sort(), filenames: [...filenames].sort() };
}

export const MAX_SELECTED_REPOS = 5;

/** "owner/name" entries (or full github.com URLs), separated by commas, spaces or new lines. */
export function parseRepoList(raw: string): { ok: true; repos: string[] } | { ok: false; error: string } {
  const entries = raw
    .split(/[\s,]+/)
    .map((e) => e.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, ''))
    .filter(Boolean);
  const repos = new Map<string, string>();
  for (const e of entries) {
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(e) || e.endsWith('/.') || e.includes('/..')) {
      return { ok: false, error: `"${e.slice(0, 40)}" is not a repository. Write it as owner/name, like octocat/hello-world.` };
    }
    repos.set(e.toLowerCase(), e);
  }
  if (repos.size > MAX_SELECTED_REPOS) return { ok: false, error: `At most ${MAX_SELECTED_REPOS} repositories.` };
  return { ok: true, repos: [...repos.values()] };
}

/** Repositories resolved on the server (numeric id, current name), checked public at creation. */
export type ResolvedRepo = { id: number; fullName: string };

function githubRulesDoc(f: ChallengeForm, repos: ResolvedRepo[]) {
  const filter = parseFileFilter(f.githubFileTypes);
  const fileFilter = filter.ok && (filter.extensions.length || filter.filenames.length) ? { extensions: filter.extensions, filenames: filter.filenames } : null;
  return {
    minMeaningfulLines: f.minLines,
    ownNonForkReposOnly: !f.allowForks,
    fileFilter,
    allow: { docs: f.allowDocs, generated: f.allowGenerated, forks: f.allowForks, backdateHours: f.backdateHours },
    ...(repos.length ? { repos: [...repos].sort((a, b) => a.id - b.id) } : {}),
  };
}

/** The off-chain rules document; its SHA-256 (canonical JSON) is stored on-chain as rules_hash. */
export function rulesDocument(f: ChallengeForm, resolved: { repos?: ResolvedRepo[] } = {}) {
  return {
    version: 1,
    mode: f.mode,
    stake: { token: f.token, buyIn: f.buyIn.trim() },
    label: f.mode === 'demo' ? `DEMO - compressed time: each day lasts ${f.demoDayMinutes} minutes. Devnet test tokens only.` : null,
    providers: [...f.providers].sort(),
    providerRule: f.providers.length > 1 ? f.providerRule : 'any',
    github: f.providers.includes('github') ? githubRulesDoc(f, resolved.repos ?? []) : null,
    leetcode: f.providers.includes('leetcode') ? { minNewSolves: f.leetcodeMinSolves, minDifficulty: f.leetcodeDifficulty } : null,
  };
}

/** Converts a valid form into the program's parameters (times in unix seconds). */
export function toPoolParams(f: ChallengeForm, nowSecs: number): PoolParams {
  const stake = STAKE_LIMITS[f.token];
  const shields = f.shieldsEnabled;
  const common = {
    buyIn: parseAmount(f.buyIn.trim(), stake.decimals),
    minParticipants: f.minPlayers,
    maxParticipants: f.maxPlayers,
    shieldPrice: shields ? parseAmount(f.shieldPrice.trim(), stake.decimals) : 0n,
    maxShieldsPerParticipant: shields ? f.maxShields : 0,
    shieldGraceSecs: shields ? f.shieldGraceMinutes * 60 : 0,
  };
  if (f.mode === 'demo') {
    const start = Math.ceil((nowSecs + f.demoStartMinutes * 60) / 60) * 60;
    return {
      ...common,
      startTs: start,
      dayLengthSecs: f.demoDayMinutes * 60,
      numDays: DEMO_NUM_DAYS,
      joinDeadlineTs: start - 60,
      verifyWindowSecs: DEMO_VERIFY_WINDOW,
      disputeWindowSecs: DEMO_DISPUTE_WINDOW,
    };
  }
  const start = Math.floor(Date.parse(`${f.startDate}T00:00:00Z`) / 1000);
  return {
    ...common,
    startTs: start,
    dayLengthSecs: PROGRAM_LIMITS.secondsPerDay,
    numDays: f.durationDays,
    joinDeadlineTs: start,
    verifyWindowSecs: REAL_VERIFY_WINDOW,
    disputeWindowSecs: REAL_DISPUTE_WINDOW,
  };
}

export type PoolParamError =
  | 'InvalidBuyIn'
  | 'InvalidDayLength'
  | 'InvalidNumDays'
  | 'StartInPast'
  | 'StartTooFar'
  | 'InvalidJoinDeadline'
  | 'InvalidParticipantLimits'
  | 'InvalidWindow'
  | 'InvalidShieldConfig';

/** Mirror of the program's validate_pool_params (same order, same bounds). */
export function validatePoolParams(p: PoolParams, nowSecs: number): PoolParamError | null {
  const L = PROGRAM_LIMITS;
  if (p.buyIn <= 0n) return 'InvalidBuyIn';
  if (p.dayLengthSecs < L.minDayLengthSecs || p.dayLengthSecs > L.secondsPerDay) return 'InvalidDayLength';
  if (p.numDays === 0 || p.numDays > L.maxNumDays) return 'InvalidNumDays';
  if (p.startTs <= nowSecs) return 'StartInPast';
  if (p.startTs - nowSecs > L.maxStartDelaySecs) return 'StartTooFar';
  if (p.joinDeadlineTs <= nowSecs || p.joinDeadlineTs > p.startTs) return 'InvalidJoinDeadline';
  if (p.minParticipants < L.minParticipants || p.maxParticipants < p.minParticipants || p.maxParticipants > L.maxParticipants) return 'InvalidParticipantLimits';
  for (const w of [p.verifyWindowSecs, p.disputeWindowSecs]) if (w < L.minWindowSecs || w > L.maxWindowSecs) return 'InvalidWindow';
  const on = p.maxShieldsPerParticipant > 0;
  if (p.maxShieldsPerParticipant > L.maxShields || (on && (p.shieldPrice === 0n || p.shieldGraceSecs > p.dayLengthSecs)) || (!on && (p.shieldPrice !== 0n || p.shieldGraceSecs !== 0))) {
    return 'InvalidShieldConfig';
  }
  return null;
}

/** What to show for each program-side refusal (in the wizard's terms). */
export const POOL_PARAM_MESSAGES: Record<PoolParamError, { field: string; message: string }> = {
  InvalidBuyIn: { field: 'buyIn', message: 'The buy-in must be above 0.' },
  InvalidDayLength: { field: 'mode', message: 'Invalid day length.' },
  InvalidNumDays: { field: 'durationDays', message: 'Choose 3, 7, 14 or 30 days.' },
  StartInPast: { field: 'startDate', message: 'The start must be in the future (tomorrow or later).' },
  StartTooFar: { field: 'startDate', message: 'The start must be within 90 days.' },
  InvalidJoinDeadline: { field: 'startDate', message: 'The start must be in the future (tomorrow or later).' },
  InvalidParticipantLimits: { field: 'minPlayers', message: 'Minimum must be at least 2 and not above the maximum.' },
  InvalidWindow: { field: 'mode', message: 'Invalid verification window.' },
  InvalidShieldConfig: { field: 'shieldPrice', message: 'Check the Shield settings.' },
};

/** Validates everything the server will (form + program rules at `nowSecs`). Field → message. */
export function validateChallengeForm(input: unknown, nowSecs: number): { ok: true; form: ChallengeForm; params: PoolParams } | { ok: false; errors: Record<string, string> } {
  const parsed = challengeFormSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const params = toPoolParams(parsed.data, nowSecs);
  const programError = validatePoolParams(params, nowSecs);
  if (programError) {
    const { field, message } = POOL_PARAM_MESSAGES[programError];
    return { ok: false, errors: { [field]: message } };
  }
  return { ok: true, form: parsed.data, params };
}
