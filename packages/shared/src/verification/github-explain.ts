// Plain-language explanations of a GitHub day check, shared by the app and `pnpm verify:github`
// so both always say the same thing. Each sentence states what was seen, not guesses.
import type { GithubDayResult, GithubSkipReason } from './github.js';

/** Why one commit did or didn't count, as shown next to it in the log. */
export const SKIP_REASON_TEXT: Record<GithubSkipReason, string> = {
  'outside-day': 'Pushed outside this day.',
  'merge-commit': 'A merge commit: merged work counts on the day it is pushed, not when merged.',
  'author-mismatch': 'Written by another GitHub account.',
  'author-unlinked': "Its git email isn't on your GitHub account, so GitHub can't tell it's yours.",
  'pushed-by-other': 'Carries your name but was pushed by another account.',
  'other-repo': "Not in one of this challenge's repositories.",
  fork: 'In a fork (this challenge doesn’t count forks).',
  'not-repo-owner': "In a repository you don't own.",
  backdated: 'Made before the day started (old work pushed late).',
  'duplicate-sha': 'Already counted on an earlier day.',
  'duplicate-diff': 'The same change was already counted (rebase or cherry-pick).',
  'whitespace-only': 'Only re-indents or moves existing lines.',
  'filtered-out': "Changes only files this challenge doesn't count.",
  'no-eligible-changes': 'No countable code (blank lines, braces, comments, docs or config).',
};

export interface CollectSummary {
  pushes: number;
  complete: boolean;
  repos: { fullName: string; status: string }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Short, specific explanations of a day, most important first. */
export function explainGithubDay(data: CollectSummary, day: GithubDayResult, goal: number, opts: { selectedRepos: boolean }): string[] {
  const hints: string[] = [];
  if (data.pushes === 0 && data.complete) {
    if (opts.selectedRepos) hints.push("You made no pushes to this challenge's repositories on this day.");
    else if (data.repos.length === 0) hints.push('None of your public repositories was pushed on this day. Pushes to private repositories are never visible: make the repository public to have it count.');
    else hints.push(`These repositories were pushed on this day, but not by you: ${data.repos.map((r) => r.fullName).join(', ')}.`);
  }
  const count = (r: GithubSkipReason) => day.skipped.filter((s) => s.reason === r).length;
  const commits = (n: number) => plural(n, 'commit', 'commits');
  if (count('author-unlinked')) hints.push(`${commits(count('author-unlinked'))} used a git email that isn't on your GitHub account. Add that email in GitHub → Settings → Emails, or commit with one that is (check \`git config user.email\`).`);
  if (count('author-mismatch')) hints.push(`${commits(count('author-mismatch'))} ${count('author-mismatch') === 1 ? 'was' : 'were'} written by another GitHub account, so ${count('author-mismatch') === 1 ? 'it doesn’t' : 'they don’t'} count for you.`);
  if (count('pushed-by-other')) hints.push(`${commits(count('pushed-by-other'))} carry your name but were pushed by another account.`);
  if (count('backdated')) hints.push(`${commits(count('backdated'))} were made before the day started.`);
  if (count('merge-commit')) hints.push(`${commits(count('merge-commit'))} ${count('merge-commit') === 1 ? 'is a merge' : 'are merges'}; merged work counts on the day it is pushed.`);
  if (count('whitespace-only')) hints.push(`${commits(count('whitespace-only'))} only re-indent or move existing lines.`);
  if (count('no-eligible-changes')) hints.push(`${commits(count('no-eligible-changes'))} ${count('no-eligible-changes') === 1 ? 'changes' : 'change'} no countable code.`);
  if (day.meetsThreshold) hints.unshift(`Goal reached: ${day.meaningfulLines} of ${goal} meaningful lines.`);
  else if (data.complete) hints.push(`${plural(goal - day.meaningfulLines, 'more meaningful line is', 'more meaningful lines are')} needed to reach ${goal}.`);
  if (!data.complete) hints.push('GitHub could not be read completely, so a day below the goal counts as "couldn’t be checked": it never costs a stake.');
  return hints.slice(0, 12);
}
