// Phase 41.2 - "Get my update": a short spoken/written briefing composed ONLY from facts the server
// loaded for the signed-in player. Pure and deterministic: the same facts give the same text, and
// times are rounded (to 5 minutes, hours, days) so pressing the button again a minute later gives
// identical text, which the audio cache can reuse instead of generating new speech.
import type { TodayStatus } from './dashboard.js';

export type BriefingProvider = 'github' | 'leetcode';

export interface BriefingChallenge {
  title: string;
  href: string | null;
  /** running: a day is in progress; starting: joined, not started yet. */
  phase: 'running' | 'starting';
  /** 0-based day in progress (running only). */
  day: number | null;
  numDays: number;
  /** Seconds until the current day ends (running) or the challenge starts (starting). */
  secsLeft: number;
  today: TodayStatus;
  providers: BriefingProvider[];
  /** "any" provider counts, or "all" are required. */
  providerRule: 'any' | 'all';
  /** Group standing by kept days, when the player can see the group (null = not computed: never guessed). */
  rank: { position: number; of: number } | null;
}

export interface BriefingInput {
  streak: { current: number; longest: number };
  /** Running / starting challenges, soonest deadline first. */
  challenges: BriefingChallenge[];
  /** Rewards or refunds ready to claim right now (formatted amounts), or null when unknown. */
  claimable: string[] | null;
  unread: { count: number; latest: string | null };
  linked: { github: boolean; leetcode: boolean; wallet: boolean };
}

export interface Briefing {
  /** What is spoken and shown, paragraph by paragraph. */
  paragraphs: string[];
  text: string;
  next: { label: string; href: string; urgent: boolean };
}

/** Spoken text is kept under this (≈ 60 s of speech). Lower-priority paragraphs are dropped first. */
export const BRIEFING_MAX_CHARS = 900;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Rounded, speakable duration: "less than a minute", "25 minutes", "2 hours and 15 minutes", "3 days". */
export function spokenDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return 'less than a minute';
  const mins = Math.round(s / 60);
  if (mins < 10) return plural(mins, 'minute');
  if (s < 3600) return plural(Math.max(10, Math.round(mins / 5) * 5), 'minute');
  if (s < 6 * 3600) {
    const total = Math.round(mins / 5) * 5;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? plural(h, 'hour') : `${plural(h, 'hour')} and ${plural(m, 'minute')}`;
  }
  if (s < 48 * 3600) return plural(Math.round(s / 3600), 'hour');
  return plural(Math.round(s / 86400), 'day');
}

/**
 * Text that may be sent to the speech service: no links, wallet / transaction addresses, emails or
 * long numbers; collapsed whitespace; trimmed to `max` characters on a word boundary.
 */
export function speakable(text: string, max = 80): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,}\b/g, ' ')
    .replace(/\b\d{9,}\b/g, ' ')
    .replace(/[<>{}[\]\\`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

function providerAction(c: BriefingChallenge): string {
  const gh = c.providers.includes('github');
  const lc = c.providers.includes('leetcode');
  if (gh && lc) return c.providerRule === 'all' ? 'push your code to GitHub and solve on LeetCode' : 'push your code to GitHub or solve on LeetCode';
  if (lc) return 'solve your LeetCode problems';
  return 'push your code to GitHub';
}

const NEEDS_WORK = new Set<TodayStatus>(['behind', 'not_checked', 'unknown']);

function todaySentence(c: BriefingChallenge): string {
  switch (c.today) {
    case 'verified':
      return 'Today is already verified on-chain. Nice work.';
    case 'shielded':
      return 'Today is covered by a Shield.';
    case 'on_track':
      return "Your latest check met today's goal. It will be recorded on-chain after the day ends.";
    case 'behind':
      return "Your latest check is still below today's goal.";
    case 'unknown':
      return "The last check couldn't read all of your activity yet.";
    case 'not_checked':
      return "Today isn't verified yet.";
    case 'failed':
      return 'Today was recorded as missed.';
    case 'undecided':
      return "Today couldn't be verified because of a provider outage. That never counts against you.";
    case 'out':
      return 'You are out of this one after a missed day, but you can still follow the group.';
    default:
      return '';
  }
}

function challengeParagraph(c: BriefingChallenge, detailed: boolean): string {
  const title = speakable(c.title, 60) || 'your challenge';
  if (c.phase === 'starting') return `${title} starts in ${spokenDuration(c.secsLeft)}.`;
  const dayPart = c.day === null ? '' : `day ${c.day + 1} of ${c.numDays}`;
  if (!detailed) {
    const status = NEEDS_WORK.has(c.today) ? 'still needs today’s work' : c.today === 'out' ? 'is over for you' : 'is in good shape today';
    return `${title}${dayPart ? `, ${dayPart},` : ''} ${status}, with ${spokenDuration(c.secsLeft)} left.`;
  }
  const parts = [`In ${title}, you're on ${dayPart || 'the current day'}, and it ends in ${spokenDuration(c.secsLeft)}.`, todaySentence(c)];
  if (c.rank && c.rank.of > 1 && c.rank.position >= 1 && c.rank.position <= c.rank.of) {
    const pos = ORDINALS[c.rank.position - 1] ?? `number ${c.rank.position}`;
    parts.push(`You're ${pos} of ${c.rank.of} in this group.`);
  }
  return parts.filter(Boolean).join(' ');
}

/** Composes the briefing. Every sentence comes from a field of `input`; nothing is estimated. */
export function composeBriefing(input: BriefingInput): Briefing {
  const running = input.challenges.filter((c) => c.phase === 'running');
  const starting = input.challenges.filter((c) => c.phase === 'starting');
  const urgent = running.find((c) => NEEDS_WORK.has(c.today));
  const primary = urgent ?? running[0] ?? starting[0] ?? null;
  const others = input.challenges.filter((c) => c !== primary).slice(0, 2);

  // Each paragraph has a priority; when the text is too long, the lowest go first.
  const paras: { text: string; priority: number }[] = [];
  if (!primary) {
    paras.push({ text: "You're not in a running challenge right now.", priority: 10 });
  } else {
    paras.push({ text: challengeParagraph(primary, true), priority: 10 });
  }
  const { current, longest } = input.streak;
  paras.push({
    text: current > 0 ? `Your current streak is ${plural(current, 'day')}${longest > current ? `, and your best is ${longest}` : ''}.` : longest > 0 ? `Your streak restarts with your next verified day. Your best is ${plural(longest, 'day')}.` : 'Your streak starts with your first verified day.',
    priority: 8,
  });
  for (const o of others) paras.push({ text: challengeParagraph(o, false), priority: 5 });
  if (input.claimable && input.claimable.length > 0) {
    paras.push({ text: `You have money ready to claim: ${input.claimable.slice(0, 3).join(' and ')}.`, priority: 9 });
  }
  if (input.unread.count > 0) {
    const latest = input.unread.latest ? speakable(input.unread.latest, 90) : '';
    paras.push({ text: `You have ${plural(input.unread.count, 'unread notification')}${latest ? `. The latest: ${latest}` : ''}.`.replace('..', '.'), priority: 4 });
  }

  // The single most important next step.
  let next: Briefing['next'];
  if (urgent) {
    next = { label: `Finish today: ${providerAction(urgent)}, then press Check now`, href: urgent.href ?? '/dashboard', urgent: true };
  } else if (input.claimable && input.claimable.length > 0) {
    next = { label: 'Claim your payout', href: '/dashboard/claims', urgent: false };
  } else if (!input.linked.github && !input.linked.leetcode) {
    next = { label: 'Link GitHub or LeetCode so your days can be verified', href: '/dashboard/settings', urgent: false };
  } else if (running.length > 0) {
    next = { label: 'Nothing urgent. Keep the streak going tomorrow', href: running[0]!.href ?? '/dashboard', urgent: false };
  } else if (starting.length > 0) {
    next = { label: 'Get ready for the start', href: starting[0]!.href ?? '/dashboard', urgent: false };
  } else {
    next = { label: 'Join or create a challenge', href: '/challenges', urgent: false };
  }
  paras.push({ text: `Next: ${next.label}.`, priority: 10 });

  // Keep it listenable: drop the lowest-priority paragraphs until it fits.
  let kept = paras;
  const length = (ps: typeof paras) => ps.reduce((n, p) => n + p.text.length + 1, 0);
  while (length(kept) > BRIEFING_MAX_CHARS) {
    const lowest = kept.reduce((lo, p) => (p.priority < lo.priority ? p : lo), kept[0]!);
    if (lowest.priority >= 10) break;
    kept = kept.filter((p) => p !== lowest);
  }
  const paragraphs = kept.map((p) => p.text);
  return { paragraphs, text: paragraphs.join(' '), next };
}
