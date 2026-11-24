#!/usr/bin/env node
// CodeStreak environment validator (zero dependencies).
//
// Usage:
//   node scripts/check-env.mjs                     # checks .env.local for the current phase
//   node scripts/check-env.mjs --phase 9           # require everything needed up to phase 9
//   node scripts/check-env.mjs --file path/.env    # check another file
//
// A variable whose phase is later than --phase is reported as "LATER" and
// does not fail. Safety rules (devnet only, no secrets in NEXT_PUBLIC_*,
// distinct operator keys) always apply.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULES as SECRET_RULES } from './check-secrets.mjs';

export const CURRENT_PHASE = 9;

// ---------------------------------------------------------------- helpers

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decodes base58 into bytes; returns null on invalid input. */
export function base58Decode(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  const bytes = [];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch === '1') bytes.push(0);
    else break;
  }
  return Uint8Array.from(bytes.reverse());
}

export function isPubkey(v) {
  const bytes = base58Decode(v);
  return bytes !== null && bytes.length === 32;
}

function decodeJwtRole(v) {
  const parts = String(v).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload?.role ?? null;
  } catch {
    return null;
  }
}

function isUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Parses a dotenv file. Supports KEY=value, quotes, inline "# comments" after unquoted values. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[m[1]] = value;
  }
  return out;
}

// ---------------------------------------------------------------- validators
// Each returns true (valid) or an error string.

const devnet = (v) => v === 'devnet' || 'must be "devnet" (CodeStreak never targets mainnet)';

const devnetRpc = (v) => {
  if (!isUrl(v)) return 'must be an http(s) URL';
  if (/mainnet/i.test(v)) return 'mainnet RPC URLs are not allowed';
  if (!/devnet/i.test(v) && !/localhost|127\.0\.0\.1/.test(v)) return 'URL should point to a devnet endpoint';
  return true;
};

const pubkey = (v) => isPubkey(v) || 'must be a base58 Solana public key (32 bytes)';

const httpsUrl = (v) => isUrl(v) || 'must be an http(s) URL';

const supabaseUrl = (v) => {
  if (!isUrl(v)) return 'must be a URL like https://<project>.supabase.co';
  if (!/\.supabase\.co\/?$/.test(v) && !/localhost|127\.0\.0\.1/.test(v)) return 'expected https://<project>.supabase.co';
  return true;
};

const publishableKey = (v) => {
  if (v.startsWith('sb_secret_')) return 'this is a SECRET key; use the publishable key here';
  if (v.startsWith('sb_publishable_')) return true;
  const role = decodeJwtRole(v);
  if (role === 'service_role') return 'this is the service_role key; it must never be public';
  if (role === 'anon') return true;
  return 'expected sb_publishable_... or the legacy anon JWT';
};

const serviceRoleKey = (v) => {
  if (v.startsWith('sb_secret_')) return true;
  if (decodeJwtRole(v) === 'service_role') return true;
  return 'expected sb_secret_... or the legacy service_role JWT';
};

const githubToken = (v) =>
  /^github_pat_[A-Za-z0-9_]{50,}$/.test(v) || /^gh[pousr]_[A-Za-z0-9]{36,}$/.test(v) || 'expected a GitHub token (github_pat_... or ghp_...)';

const firecrawlKey = (v) => /^fc-[A-Za-z0-9]{24,}$/.test(v) || 'expected a Firecrawl key starting with fc-';

const longSecret = (v) => v.length >= 32 || 'must be at least 32 characters (use 32 random bytes as hex)';

const nonEmpty = (v) => v.length > 0 || 'must not be empty';

const keypairPath = (v) => {
  if (!existsSync(v)) return `file not found: ${v}`;
  try {
    const arr = JSON.parse(readFileSync(v, 'utf8'));
    if (Array.isArray(arr) && arr.length === 64) return true;
  } catch {
    /* fall through */
  }
  return 'file is not a 64-byte Solana keypair JSON';
};

// ---------------------------------------------------------------- spec

const WSOL = 'So11111111111111111111111111111111111111112';

export const SPEC = [
  { name: 'SOLANA_CLUSTER', phase: 1, validate: devnet },
  {
    name: 'SOLANA_RPC_URL',
    phase: 1,
    validate: devnetRpc,
    warn: (v) => (v.includes('api.devnet.solana.com') ? 'public devnet RPC is rate-limited; switch to a Helius devnet URL before Phase 9' : null),
  },
  { name: 'NEXT_PUBLIC_SOLANA_CLUSTER', phase: 1, validate: devnet },
  {
    name: 'NEXT_PUBLIC_SOLANA_RPC_URL',
    phase: 1,
    validate: devnetRpc,
    warn: (v) => (/api-key=/.test(v) ? 'this key is visible in the browser; restrict it to your domain in the RPC dashboard' : null),
  },
  { name: 'NEXT_PUBLIC_USDC_MINT', phase: 1, validate: pubkey },
  { name: 'NEXT_PUBLIC_WSOL_MINT', phase: 1, validate: (v) => v === WSOL || `must be the native mint ${WSOL}` },

  { name: 'UPGRADE_AUTHORITY_PUBKEY', phase: 1, validate: pubkey, operatorKey: true },
  { name: 'RELAYER_PUBKEY', phase: 1, validate: pubkey, operatorKey: true },
  { name: 'VERIFIER_PUBKEY', phase: 1, validate: pubkey, operatorKey: true },
  { name: 'ADMIN_PUBKEY', phase: 1, validate: pubkey, operatorKey: true },

  { name: 'NEXT_PUBLIC_SUPABASE_URL', phase: 1, validate: supabaseUrl },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', phase: 1, validate: publishableKey },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', phase: 1, validate: serviceRoleKey, secret: true },

  { name: 'GITHUB_API_TOKEN', phase: 1, validate: githubToken, secret: true },
  { name: 'FIRECRAWL_API_KEY', phase: 1, validate: firecrawlKey, secret: true },

  { name: 'APP_URL', phase: 1, validate: httpsUrl },
  { name: 'NEXT_PUBLIC_CODESTREAK_PROGRAM_ID', phase: 9, validate: pubkey },
  { name: 'WORKER_URL', phase: 14, validate: httpsUrl },
  { name: 'WORKER_JOB_SECRET', phase: 14, validate: longSecret, secret: true },
  { name: 'RELAYER_KEYPAIR_PATH', phase: 9, validate: keypairPath, secret: true, altName: 'RELAYER_KEYPAIR_JSON' },
  // Local only (one-time `pnpm devnet:init-config`); never set on Render.
  { name: 'UPGRADE_AUTHORITY_KEYPAIR_PATH', phase: 9, validate: keypairPath, secret: true, optional: true },
  { name: 'VERIFIER_KEYPAIR_PATH', phase: 28, validate: keypairPath, secret: true, altName: 'VERIFIER_KEYPAIR_JSON' },
];

const KNOWN = new Set(SPEC.flatMap((s) => [s.name, s.altName].filter(Boolean)));

// ---------------------------------------------------------------- core

/**
 * Validates env values for a phase.
 * Returns { rows: [{ name, status, detail }], errors, warnings }.
 * status: OK | MISSING | INVALID | LATER | WARN
 */
export function validateEnv(env, phase = CURRENT_PHASE) {
  const rows = [];
  let errors = 0;
  let warnings = 0;

  for (const spec of SPEC) {
    let value = env[spec.name] ?? '';
    let usedName = spec.name;
    if (!value && spec.altName && env[spec.altName]) {
      value = env[spec.altName];
      usedName = spec.altName;
    }
    const required = spec.phase <= phase;

    if (!value) {
      if (spec.optional) {
        rows.push({ name: spec.name, status: 'LATER', detail: 'optional (only for one-time local scripts)' });
      } else if (required) {
        rows.push({ name: spec.name, status: 'MISSING', detail: `required from Phase ${spec.phase}` });
        errors++;
      } else {
        rows.push({ name: spec.name, status: 'LATER', detail: `needed in Phase ${spec.phase}` });
      }
      continue;
    }

    // JSON keypair given inline (Render style)
    const result =
      usedName.endsWith('_KEYPAIR_JSON')
        ? (() => {
            try {
              const arr = JSON.parse(value);
              return (Array.isArray(arr) && arr.length === 64) || 'must be a 64-number JSON array';
            } catch {
              return 'must be a 64-number JSON array';
            }
          })()
        : spec.validate(value);

    if (result !== true) {
      rows.push({ name: spec.name, status: 'INVALID', detail: result });
      errors++;
      continue;
    }

    const w = spec.warn ? spec.warn(value) : null;
    if (w) {
      rows.push({ name: spec.name, status: 'WARN', detail: w });
      warnings++;
    } else {
      rows.push({ name: spec.name, status: 'OK', detail: spec.secret ? 'set (hidden)' : value.length > 60 ? `${value.slice(0, 57)}...` : value });
    }
  }

  // Rule: nothing secret-looking may be in a NEXT_PUBLIC_* variable.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
    for (const rule of SECRET_RULES) {
      rule.regex.lastIndex = 0;
      const m = rule.regex.exec(value);
      if (m && (!rule.check || rule.check(m[0], value, m.index))) {
        if (rule.id === 'rpc-api-key-in-url') continue; // warned above, common practice with domain restriction
        rows.push({ name, status: 'INVALID', detail: `secret in a browser-visible variable (${rule.description})` });
        errors++;
      }
    }
  }

  // Rule: the four operator keys must be distinct.
  const opKeys = SPEC.filter((s) => s.operatorKey && env[s.name]).map((s) => [s.name, env[s.name]]);
  const seen = new Map();
  for (const [name, value] of opKeys) {
    if (seen.has(value)) {
      rows.push({ name, status: 'INVALID', detail: `same key as ${seen.get(value)}; each role needs its own keypair` });
      errors++;
    } else {
      seen.set(value, name);
    }
  }

  // Unknown variables (typos) are warnings.
  for (const name of Object.keys(env)) {
    if (!KNOWN.has(name)) {
      rows.push({ name, status: 'WARN', detail: 'unknown variable (typo?)' });
      warnings++;
    }
  }

  return { rows, errors, warnings };
}

// ---------------------------------------------------------------- CLI

const COLORS = { OK: 32, LATER: 90, WARN: 33, MISSING: 31, INVALID: 31 };

function main(argv) {
  const args = argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = get('--file') ?? '.env.local';
  const phase = Number(get('--phase') ?? process.env.CODESTREAK_PHASE ?? CURRENT_PHASE);

  if (!existsSync(file)) {
    console.error(`check-env: ${file} not found.`);
    console.error('Create it first:  Copy-Item .env.example .env.local   (PowerShell)');
    console.error('                  cp .env.example .env.local          (bash)');
    return 1;
  }

  const env = parseDotenv(readFileSync(file, 'utf8'));
  const { rows, errors, warnings } = validateEnv(env, phase);
  const color = process.stdout.isTTY;

  console.log(`check-env: ${file} (requirements up to Phase ${phase})\n`);
  for (const r of rows) {
    const tag = `[${r.status}]`.padEnd(10);
    const line = `${tag}${r.name.padEnd(38)}${r.detail}`;
    console.log(color ? `\x1b[${COLORS[r.status]}m${line}\x1b[0m` : line);
  }
  console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main(process.argv);
}
