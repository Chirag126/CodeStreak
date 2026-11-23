// Checks one GitHub account for one day with the real verifier, against the live GitHub API.
//   pnpm verify:github -- --login Chirag126 --date 2026-11-22 [--min 15] [--files ".ts main.py"]
//                         [--allow docs,generated,forks] [--backdate 4] [--repos owner/name,owner/other] [--json]
// Uses GITHUB_API_TOKEN from .env.local when set (5000 requests/hour instead of 60).
import { parseFileFilter } from '@codestreak/shared';
import { collectGithubCommits, createGithubGet, evaluateGithubDay, githubDayOutcome, githubRulesFromDocument } from '@codestreak/shared/verification';
import { loadLocalEnv } from './load-env.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

async function main() {
  loadLocalEnv();
  const login = arg('login');
  const date = arg('date');
  if (!login || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: pnpm verify:github -- --login <github-login> --date YYYY-MM-DD [--min 15] [--files ".ts main.py"] [--allow docs,generated,forks] [--backdate 4] [--json]');
    process.exit(2);
  }
  const filter = parseFileFilter(arg('files') ?? '');
  if (!filter.ok) throw new Error(filter.error);
  const allow = new Set((arg('allow') ?? '').split(',').filter(Boolean));
  const rules = githubRulesFromDocument({
    minMeaningfulLines: Number(arg('min') ?? 15),
    ownNonForkReposOnly: !allow.has('forks'),
    fileFilter: { extensions: filter.extensions, filenames: filter.filenames },
    allow: { docs: allow.has('docs'), generated: allow.has('generated'), forks: allow.has('forks'), backdateHours: Number(arg('backdate') ?? 0) },
  });

  const get = createGithubGet(process.env.GITHUB_API_TOKEN || undefined);
  const user = await get(`/users/${encodeURIComponent(login)}`);
  const githubId = (user.json as { id?: number } | null)?.id;
  if (user.status !== 200 || !githubId) throw new Error(`GitHub user ${login} not found (${user.status})`);

  // Selected repositories (like a challenge's "only these repositories" option), resolved to ids.
  const repoIds: number[] = [];
  for (const name of (arg('repos') ?? '').split(',').map((r) => r.trim()).filter(Boolean)) {
    const r = await get(`/repos/${name}`);
    const id = (r.json as { id?: number } | null)?.id;
    if (r.status !== 200 || !id) throw new Error(`Repository ${name} not found or not public (${r.status})`);
    repoIds.push(id);
  }
  rules.repos = repoIds;

  const startSec = Date.parse(`${date}T00:00:00Z`) / 1000;
  const window = { startSec, endSec: startSec + 86_400 };
  const data = await collectGithubCommits({ get, githubId, window, repoIds });
  const day = evaluateGithubDay({ commits: data.commits, userGithubId: githubId, window, rules, seen: { shas: new Set(), diffHashes: new Set() } });
  const outcome = githubDayOutcome(day, data);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ login, githubId, date, outcome, data: { complete: data.complete, notes: data.notes, apiCalls: data.apiCalls }, day }, null, 2));
    return;
  }
  console.log(`\n${login} (GitHub ID ${githubId}), ${date} UTC: ${outcome.toUpperCase()}`);
  console.log(`  ${day.meaningfulLines} of ${rules.minMeaningfulLines} meaningful lines (code ${day.breakdown.code}, docs ${day.breakdown.docsCredited}/${day.breakdown.docs}, generated ${day.breakdown.generatedCredited}/${day.breakdown.generated})`);
  console.log(`  ${data.pushes} pushes, ${data.commits.length} commits read with ${data.apiCalls} API calls${data.complete ? '' : ' (INCOMPLETE)'}`);
  for (const r of data.repos) console.log(`  repo     ${r.fullName}: ${r.pushes} push${r.pushes === 1 ? '' : 'es'} by you (${r.status})`);
  for (const n of data.notes) console.log(`  note: ${n}`);
  for (const c of day.counted) console.log(`  counted  ${c.sha.slice(0, 8)}  ${c.repo}  ${c.meaningfulLines} lines`);
  for (const s of day.skipped) console.log(`  skipped  ${s.sha.slice(0, 8)}  ${s.repo}  ${s.reason}`);
  for (const a of day.anomalies) console.log(`  flagged  ${a.sha.slice(0, 8)}  ${a.detail}`);
  for (const hint of explain(data, day, rules.minMeaningfulLines, repoIds.length > 0)) console.log(`\n  ${hint}`);
}

/** Specific explanations from what was actually read (no guessing). */
function explain(
  data: { pushes: number; complete: boolean; repos: { fullName: string; status: string }[] },
  day: { meaningfulLines: number; counted: unknown[]; skipped: { reason: string }[] },
  goal: number,
  selected: boolean,
): string[] {
  const hints: string[] = [];
  if (data.pushes === 0 && data.complete) {
    if (selected) hints.push('You made no pushes to the selected repositories on this day.');
    else if (data.repos.length === 0) hints.push('None of your public repositories was pushed on this day. Pushes to private repositories are never visible: make the repository public to have it count.');
    else hints.push(`These repositories were pushed on this day, but not by you: ${data.repos.map((r) => r.fullName).join(', ')}.`);
  }
  const count = (reason: string) => day.skipped.filter((s) => s.reason === reason).length;
  const n = (k: number) => `${k} commit${k === 1 ? '' : 's'}`;
  if (count('author-mismatch')) hints.push(`${n(count('author-mismatch'))} have an author that isn't your GitHub account: the git email used is not one of your GitHub emails (check \`git config user.email\` against GitHub → Settings → Emails).`);
  if (count('pushed-by-other')) hints.push(`${n(count('pushed-by-other'))} carry your name but were pushed by another account, so they don't count.`);
  if (count('backdated')) hints.push(`${n(count('backdated'))} were made before the day started (old work pushed late).`);
  if (count('merge-commit')) hints.push(`${n(count('merge-commit'))} are merges; merged work counts on the day it was pushed, not when merged.`);
  if (count('whitespace-only')) hints.push(`${n(count('whitespace-only'))} only re-indent or move existing lines.`);
  if (count('no-eligible-changes')) hints.push(`${n(count('no-eligible-changes'))} change no countable code (blank lines, braces, comments, docs or config).`);
  if (day.meaningfulLines < goal && (day.counted.length > 0 || data.pushes > 0)) hints.push(`${goal - day.meaningfulLines} more meaningful lines are needed to reach ${goal}.`);
  if (!data.complete) hints.push('GitHub could not be read completely, so a day below the goal is "indeterminate": it never costs a stake.');
  return hints;
}
