// Checks one GitHub account for one day with the real verifier, against the live GitHub API.
//   pnpm verify:github -- --login Chirag126 --date 2026-11-22 [--min 15] [--files ".ts main.py"]
//                         [--allow docs,generated,forks] [--backdate 4] [--json]
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

  const startSec = Date.parse(`${date}T00:00:00Z`) / 1000;
  const window = { startSec, endSec: startSec + 86_400 };
  const data = await collectGithubCommits({ get, githubId, window });
  const day = evaluateGithubDay({ commits: data.commits, userGithubId: githubId, window, rules, seen: { shas: new Set(), diffHashes: new Set() } });
  const outcome = githubDayOutcome(day, data);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ login, githubId, date, outcome, data: { complete: data.complete, notes: data.notes, apiCalls: data.apiCalls }, day }, null, 2));
    return;
  }
  console.log(`\n${login} (GitHub ID ${githubId}), ${date} UTC: ${outcome.toUpperCase()}`);
  console.log(`  ${day.meaningfulLines} of ${rules.minMeaningfulLines} meaningful lines (code ${day.breakdown.code}, docs ${day.breakdown.docsCredited}/${day.breakdown.docs}, generated ${day.breakdown.generatedCredited}/${day.breakdown.generated})`);
  console.log(`  ${data.commits.length} commits read with ${data.apiCalls} API calls${data.complete ? '' : ' (INCOMPLETE)'}`);
  for (const n of data.notes) console.log(`  note: ${n}`);
  for (const c of day.counted) console.log(`  counted  ${c.sha.slice(0, 8)}  ${c.repo}  ${c.meaningfulLines} lines`);
  for (const s of day.skipped) console.log(`  skipped  ${s.sha.slice(0, 8)}  ${s.repo}  ${s.reason}`);
  for (const a of day.anomalies) console.log(`  flagged  ${a.sha.slice(0, 8)}  ${a.detail}`);
  for (const hint of explain(data, day, rules.minMeaningfulLines)) console.log(`\n  ${hint}`);
}

/** Plain-language hints for the most common "why didn't it count?" cases. */
function explain(
  data: { pushes: number; complete: boolean },
  day: { meaningfulLines: number; counted: unknown[]; skipped: { reason: string }[] },
  goal: number,
): string[] {
  const hints: string[] = [];
  if (data.pushes === 0 && data.complete) {
    hints.push(
      'No public push events for this day. Either GitHub has not listed the push yet (its public feed can lag by minutes to hours: run this again later), the repository is private (private pushes are never visible), or the push was made from another GitHub account.',
    );
  }
  const reasons = new Set(day.skipped.map((s) => s.reason));
  if (reasons.has('author-mismatch')) {
    hints.push('Some commits are authored by someone else, or by a git email not added to this GitHub account (check `git config user.email`).');
  }
  if (reasons.has('backdated')) hints.push('Some commits were made before the day started (old work pushed late).');
  if (day.counted.length > 0 && day.meaningfulLines < goal) {
    hints.push(`Pushes were found, but ${goal - day.meaningfulLines} more meaningful lines are needed to reach ${goal}.`);
  }
  return hints;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
