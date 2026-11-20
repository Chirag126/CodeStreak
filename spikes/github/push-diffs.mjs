#!/usr/bin/env node
// Phase 2 spike B: GitHub public push evidence (official REST API, no dependencies).
//
//   pnpm github                # uses the GitHub account that owns GITHUB_API_TOKEN
//   pnpm github <login>        # any public GitHub user
//
// Answers:
//   1. Which fields do PushEvents still carry (commits were removed in 2025)?
//   2. Can we get from a push -> commits -> per-file diffs via the Compare + Commit APIs?
//   3. Push time (GitHub server clock) vs commit author date (user-controlled).
//   4. Fork / ownership checks and API rate-limit cost.
import { countMeaningfulAdditions, isEligibleFile } from '../lib/github-diff.mjs';

const TOKEN = process.env.GITHUB_API_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_API_TOKEN is not set. Run via `pnpm github` so ../.env.local is loaded.');
  process.exit(1);
}

const MAX_PUSHES = 3;
const MAX_COMMITS_PER_PUSH = 5;
let calls = 0;
let rate = {};

async function gh(path) {
  calls++;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codestreak-spike',
    },
  });
  rate = { remaining: res.headers.get('x-ratelimit-remaining'), limit: res.headers.get('x-ratelimit-limit') };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const ZERO_SHA = /^0{40}$/;

async function main() {
  const login = process.argv[2] ?? (await gh('/user')).login;
  const user = await gh(`/users/${encodeURIComponent(login)}`);
  console.log(`\nGitHub user: ${user.login} (numeric id ${user.id})`);

  const events = await gh(`/users/${encodeURIComponent(login)}/events/public?per_page=100`);
  const pushes = events.filter((e) => e.type === 'PushEvent');
  console.log(`Public events returned: ${events.length}, PushEvents: ${pushes.length}`);
  if (pushes.length === 0) {
    console.log('No public pushes in the event window. Push a commit to a public repo and rerun.');
    return report();
  }
  console.log(`PushEvent payload keys: ${Object.keys(pushes[0].payload).sort().join(', ')}`);
  console.log(`Has payload.commits: ${'commits' in pushes[0].payload}`);

  for (const ev of pushes.slice(0, MAX_PUSHES)) {
    const { before, head, ref } = ev.payload;
    console.log(`\n=== Push to ${ev.repo.name} ${ref ?? ''} at ${ev.created_at} (GitHub server time)`);

    const repo = await gh(`/repos/${ev.repo.name}`);
    console.log(`  repo: fork=${repo.fork} owner=${repo.owner.login} private=${repo.private}`);

    let commits;
    if (!before || ZERO_SHA.test(before) || !head) {
      commits = head ? [await gh(`/repos/${ev.repo.name}/commits/${head}`)] : [];
      console.log('  new branch push: only the head commit is inspected');
    } else {
      try {
        const cmp = await gh(`/repos/${ev.repo.name}/compare/${before}...${head}`);
        console.log(`  compare: status=${cmp.status} total_commits=${cmp.total_commits}`);
        commits = cmp.commits;
      } catch (e) {
        console.log(`  compare failed (force-push or deleted base?): ${e.message}`);
        commits = [await gh(`/repos/${ev.repo.name}/commits/${head}`)];
      }
    }

    for (const c of commits.slice(0, MAX_COMMITS_PER_PUSH)) {
      const full = c.files ? c : await gh(`/repos/${ev.repo.name}/commits/${c.sha}`);
      const authoredByUser = full.author?.id === user.id;
      const authorDate = full.commit.author.date;
      const lagMin = Math.round((Date.parse(ev.created_at) - Date.parse(authorDate)) / 60000);
      let meaningful = 0;
      let missingPatches = 0;
      for (const f of full.files ?? []) {
        if (!isEligibleFile(f.filename)) continue;
        const r = countMeaningfulAdditions(f.patch);
        meaningful += r.meaningful;
        if (r.patchMissing) missingPatches++;
      }
      console.log(
        `  - ${full.sha.slice(0, 7)} author_id_match=${authoredByUser} author_date=${authorDate} (push - author = ${lagMin} min)` +
          ` files=${full.files?.length ?? 0} meaningful_lines=${meaningful}${missingPatches ? ` missing_patches=${missingPatches}` : ''}`,
      );
      for (const f of (full.files ?? []).slice(0, 6)) {
        console.log(`      ${f.status.padEnd(8)} +${f.additions}/-${f.deletions} ${isEligibleFile(f.filename) ? 'eligible ' : 'ignored  '} ${f.filename}${f.patch ? '' : ' (no patch)'}`);
      }
    }
  }
  report();
}

function report() {
  console.log(`\nAPI calls: ${calls}, rate limit remaining: ${rate.remaining}/${rate.limit}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  report();
  process.exit(1);
});
