#!/usr/bin/env node
// CodeStreak secret scanner (zero dependencies).
//
// Usage:
//   node scripts/check-secrets.mjs --staged     # scan the staged version of staged files (pre-commit)
//   node scripts/check-secrets.mjs --all        # scan every tracked file
//   node scripts/check-secrets.mjs <file> ...   # scan specific files
//
// Exit code 1 when anything is found. A line containing "secret-scan:allow"
// is skipped, for documented false positives only.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ALLOW_MARKER = 'secret-scan:allow';
const MAX_BYTES = 5 * 1024 * 1024;

const BASE58 = '1-9A-HJ-NP-Za-km-z';

/** Decodes the payload of a JWT and reports whether it carries role=service_role. */
function isServiceRoleJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && payload.role === 'service_role';
  } catch {
    return false;
  }
}

/** 64-byte base58 strings are either secret keys or transaction signatures. Skip obvious signatures. */
function isLikelyBase58Secret(match, line, index) {
  const before = line.slice(Math.max(0, index - 24), index).toLowerCase();
  if (before.includes('/tx/') || before.includes('signature') || before.includes('sig=') || before.includes('txid')) {
    return false;
  }
  return true;
}

/** Content rules. `check` (optional) can veto a regex match. */
export const RULES = [
  {
    id: 'solana-keypair-array',
    description: 'Solana keypair (64-byte secret key as a JSON number array)',
    regex: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g,
  },
  {
    id: 'base58-secret-key',
    description: 'Possible base58-encoded 64-byte Solana secret key',
    regex: new RegExp(`(?<![${BASE58}])[${BASE58}]{86,88}(?![${BASE58}])`, 'g'),
    check: isLikelyBase58Secret,
  },
  {
    id: 'pem-private-key',
    description: 'PEM private key block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: 'github-token',
    description: 'GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'github-fine-grained-pat',
    description: 'GitHub fine-grained personal access token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  },
  {
    id: 'supabase-secret-key',
    description: 'Supabase secret API key (sb_secret_...)',
    regex: /\bsb_secret_[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'supabase-service-role-jwt',
    description: 'Supabase service_role JWT',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    check: (match) => isServiceRoleJwt(match),
  },
  {
    id: 'firecrawl-api-key',
    description: 'Firecrawl API key (fc-...)',
    regex: /\bfc-[A-Za-z0-9]{24,}\b/g,
  },
  {
    id: 'sk-style-api-key',
    description: 'API key with sk_ prefix (Stripe-style and others)',
    regex: /\bsk_[A-Za-z0-9]{32,}\b/g,
  },
  {
    id: 'rpc-api-key-in-url',
    description: 'API key embedded in an RPC URL (?api-key=...)',
    regex: /[?&]api-key=[A-Za-z0-9-]{20,}/g,
  },
];

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|KEYPAIR_JSON)$/i;
// Names that end like a secret but are public by design.
const PUBLIC_NAMES = new Set(['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);

/** Returns a reason string if the file path itself must never be committed. */
export function checkFilename(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const base = p.split('/').pop();
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    return 'environment file (only .env.example may be committed)';
  }
  if (base === 'id.json' || /keypair.*\.json$/i.test(base)) {
    return 'Solana keypair file';
  }
  if (/(^|\/)(\.keys|keys)\/[^/]+\.json$/.test(p)) {
    return 'file inside a keys/ directory';
  }
  if (/\.(pem|key)$/i.test(base)) {
    return 'private key file';
  }
  return null;
}

function mask(value) {
  const v = String(value);
  return v.length <= 8 ? '****' : `${v.slice(0, 6)}…(${v.length} chars)`;
}

/** Scans text content. Returns [{ file, line, rule, description, preview }]. */
export function scanText(filePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const isEnvExample = filePath.replace(/\\/g, '/').split('/').pop() === '.env.example';

  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;

    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(line)) !== null) {
        if (!rule.check || rule.check(m[0], line, m.index)) {
          findings.push({ file: filePath, line: i + 1, rule: rule.id, description: rule.description, preview: mask(m[0]) });
        }
        if (m[0].length === 0) rule.regex.lastIndex++;
      }
    }

    // .env.example must contain no secret values at all.
    if (isEnvExample) {
      const assign = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (assign && !line.trimStart().startsWith('#')) {
        const [, name, value] = assign;
        if (value !== '' && SECRET_NAME.test(name) && !PUBLIC_NAMES.has(name)) {
          findings.push({
            file: filePath,
            line: i + 1,
            rule: 'env-example-secret-value',
            description: `.env.example must leave ${name} empty`,
            preview: mask(value),
          });
        }
      }
    }
  });

  return findings;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Scans one file given its path and its content buffer. */
export function scanFile(filePath, buf) {
  const findings = [];
  const nameReason = checkFilename(filePath);
  if (nameReason) {
    findings.push({ file: filePath, line: 0, rule: 'forbidden-file', description: nameReason, preview: '' });
  }
  if (buf && buf.length <= MAX_BYTES && !isBinary(buf)) {
    findings.push(...scanText(filePath, buf.toString('utf8')));
  }
  return findings;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: opts.encoding ?? 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function stagedFiles() {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  return out.split('\0').filter(Boolean);
}

function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

function readStaged(file) {
  return execFileSync('git', ['show', `:${file}`], { maxBuffer: 64 * 1024 * 1024 });
}

function main(argv) {
  const args = argv.slice(2);
  let targets;
  let reader;

  if (args.includes('--staged')) {
    targets = stagedFiles();
    reader = readStaged;
  } else if (args.includes('--all')) {
    targets = trackedFiles();
    reader = (f) => (existsSync(f) && statSync(f).isFile() ? readFileSync(f) : null);
  } else if (args.length > 0) {
    targets = args;
    reader = (f) => readFileSync(f);
  } else {
    console.error('Usage: check-secrets.mjs --staged | --all | <file...>');
    return 2;
  }

  const findings = [];
  for (const file of targets) {
    let buf = null;
    try {
      buf = reader(file);
    } catch {
      buf = null;
    }
    findings.push(...scanFile(file, buf));
  }

  if (findings.length === 0) {
    console.log(`secret-scan: OK (${targets.length} file${targets.length === 1 ? '' : 's'} checked)`);
    return 0;
  }

  console.error(`secret-scan: ${findings.length} problem${findings.length === 1 ? '' : 's'} found`);
  for (const f of findings) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(`  ✖ ${loc}  [${f.rule}] ${f.description}${f.preview ? `  ${f.preview}` : ''}`);
  }
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main(process.argv);
}
