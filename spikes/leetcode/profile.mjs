#!/usr/bin/env node
// Phase 2 spike C: LeetCode public profile via Firecrawl (no dependencies).
//
//   pnpm leetcode <handle> [<handle> ...]           # parse solved count + recent accepted
//   pnpm leetcode <handle> --code CS-VERIFY-XXXX   # also check the code is in the profile summary
//   pnpm leetcode <handle> --twice                 # two live snapshots 60s apart, then diff
//
// Uses Firecrawl v2 /scrape with formats ["markdown"] and maxAge 0 (live fetch,
// never Firecrawl's cache). Parsing is deterministic code, not LLM extraction.
import { parseLeetCodeProfile, containsVerificationCode, diffSnapshots } from '../lib/leetcode-parse.mjs';

const KEY = process.env.FIRECRAWL_API_KEY;
if (!KEY) {
  console.error('FIRECRAWL_API_KEY is not set. Run via `pnpm leetcode` so ../.env.local is loaded.');
  process.exit(1);
}

const args = process.argv.slice(2);
const codeIdx = args.indexOf('--code');
const code = codeIdx >= 0 ? args[codeIdx + 1] : null;
const twice = args.includes('--twice');
const handles = args.filter((a, i) => !a.startsWith('--') && (codeIdx < 0 || i !== codeIdx + 1));

if (handles.length === 0) {
  console.error('Usage: pnpm leetcode <handle> [<handle> ...] [--code CS-VERIFY-XXXX] [--twice]');
  process.exit(2);
}

async function scrape(handle) {
  const started = Date.now();
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `https://leetcode.com/u/${encodeURIComponent(handle)}/`,
      formats: ['markdown'],
      onlyMainContent: false,
      maxAge: 0,
      waitFor: 4000,
      timeout: 60000,
    }),
  });
  const ms = Date.now() - started;
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    return { ok: false, ms, status: res.status, error: body.error ?? `HTTP ${res.status}` };
  }
  const md = body.data?.markdown ?? '';
  return {
    ok: true,
    ms,
    pageStatus: body.data?.metadata?.statusCode,
    credits: body.data?.metadata?.creditsUsed,
    markdown: md,
    parsed: parseLeetCodeProfile(md),
    observedAt: new Date().toISOString(),
  };
}

function print(handle, r) {
  console.log(`\n=== ${handle}`);
  if (!r.ok) {
    console.log(`  FIRECRAWL ERROR (would be INDETERMINATE): ${r.status} ${r.error} [${r.ms} ms]`);
    return;
  }
  const p = r.parsed;
  console.log(`  page status=${r.pageStatus} credits=${r.credits} time=${r.ms} ms observed_at=${r.observedAt}`);
  console.log(`  solved=${p.solved ?? 'NOT FOUND'} / ${p.totalProblems ?? '?'}  recent_ac_section=${p.hasRecentAcSection}  entries=${p.recentAccepted.length}`);
  for (const a of p.recentAccepted.slice(0, 5)) {
    console.log(`    #${a.submissionId}  ${a.ago.padEnd(16)} ${a.title}`);
  }
  if (code) console.log(`  verification code "${code}" present: ${containsVerificationCode(r.markdown, code)}`);
  if (p.solved === null) console.log('  NOTE: solved count not found -> profile private, handle wrong, or page layout changed');
}

for (const handle of handles) {
  const first = await scrape(handle);
  print(handle, first);
  if (twice && first.ok) {
    console.log('  waiting 60s for a second live snapshot (solve something now to see a diff)...');
    await new Promise((r) => setTimeout(r, 60000));
    const second = await scrape(handle);
    print(`${handle} (snapshot 2)`, second);
    if (second.ok) {
      const d = diffSnapshots(first.parsed, second.parsed);
      console.log(`  DIFF: solvedDelta=${d.solvedDelta} newAccepted=${d.newAccepted.map((a) => `#${a.submissionId} ${a.title}`).join(', ') || 'none'}`);
    }
  }
}
