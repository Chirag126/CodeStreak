# Render deployment notes

Everything runs on Render's **free plan**: a web service (Next.js app) and a worker web service
(Supabase `pg_cron` + `pg_net` wake it, because the free plan has no cron jobs or background workers).

## Live services (created in Phase 14)

| Service | Render name | URL | Plan / region |
|---|---|---|---|
| Web (Next.js) | `codestreak` | https://codestreak-k0uv.onrender.com | free, Singapore |
| Worker | `codestreak-worker` | https://codestreak-worker.onrender.com | free, Singapore |

Both auto-deploy from `main`. Build and start commands:

- **codestreak:** `corepack enable && pnpm install --no-frozen-lockfile --production=false && pnpm --filter @codestreak/shared build && pnpm --filter @codestreak/web build` → `pnpm --filter @codestreak/web start`
- **codestreak-worker:** `corepack enable && pnpm install --no-frozen-lockfile --production=false && pnpm --filter @codestreak/shared build && pnpm --filter @codestreak/worker build` → `node apps/worker/dist/index.js`
- Health checks: web `GET /api/health`, worker `GET /health`. Set them under Settings → Health Check Path.

**Free plan budget:** 750 instance-hours a month for the whole workspace (shared with your other free services). Each free service sleeps after ~15 idle minutes and takes up to about a minute to wake. The worker is woken every 30 minutes by Supabase (below), so it is awake about half the time.

**Waking the worker:** Supabase `pg_cron` job `codestreak-wake-worker` (every 30 minutes) calls `private.wake_worker('wake')`, which POSTs to `<worker_url>/jobs/wake` through `pg_net` with the secret. The URL and secret live in **Supabase Vault** as `worker_url` and `worker_job_secret`. The secret is generated inside Supabase; copy it to the worker's `WORKER_JOB_SECRET` from Supabase → Project Settings → Vault.

This file is updated every phase. It lists what currently points at **localhost** or at files on
your laptop, and what each value must be on Render. Never commit real secret values: set them in
Render → Service → Environment.

## 1. Values that change on Render

| Variable / setting | Local value now | On Render | Service | Since |
|---|---|---|---|---|
| `APP_URL` | `http://localhost:3000` | `https://codestreak-k0uv.onrender.com` (**set**) | web | 1 (used from 12; invite links from 20) |
| Supabase → Auth → URL Configuration → **Site URL** | `http://localhost:3000` | `https://codestreak-k0uv.onrender.com` | Supabase dashboard | 12 |
| Supabase → Auth → URL Configuration → **Redirect URLs** | `http://localhost:3000/**` | add `https://codestreak-k0uv.onrender.com/**` (keep localhost for development) | Supabase dashboard | 12 |
| `RELAYER_KEYPAIR_PATH` | `\\wsl$\Ubuntu\home\chirag_126\.config\codestreak\keys\relayer.json` | **don't set**; set **`RELAYER_KEYPAIR_JSON`** instead: the file's whole contents (a JSON array of 64 numbers). **Required from Phase 15** (sponsored joins). Get it in WSL with `cat ~/.config/codestreak/keys/relayer.json` | web | 9 / 15 |
| `UPGRADE_AUTHORITY_KEYPAIR_PATH` | path to `upgrade-authority.json` | **never set on Render** (local, one-time scripts only) | - | 9 |
| `VERIFIER_KEYPAIR_PATH` | (not used yet) | **don't set**; set `VERIFIER_KEYPAIR_JSON` instead | worker | 28 |
| `WORKER_URL` | `http://localhost:10000` (local worker) | `https://codestreak-worker.onrender.com` (Supabase Vault `worker_url` is **set**) | web | 14 |
| `WORKER_JOB_SECRET` | any 64-hex value in `.env.local` | the Vault `worker_job_secret` value (**secret**) | worker | 14 |

## 2. Values that stay the same on Render

Copy these from your `.env.local` as they are.

| Variable | Notes | Service |
|---|---|---|
| `SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_CLUSTER` | always `devnet` (mainnet is rejected) | web, worker |
| `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | devnet RPC. The public one is rate-limited; a Helius devnet URL is better for the demo | web, worker |
| `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_WSOL_MINT` | devnet USDC / native mint | web |
| `NEXT_PUBLIC_CODESTREAK_PROGRAM_ID` | `A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J` | web |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same project | web, worker |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret**. Web: wallet linking (Phase 13). Worker: writes `worker.wake` to the audit log (Phase 14) | web, worker |
| `UPGRADE_AUTHORITY_PUBKEY`, `RELAYER_PUBKEY`, `VERIFIER_PUBKEY`, `ADMIN_PUBKEY` | public keys, safe | web |
| `GITHUB_API_TOKEN`, `FIRECRAWL_API_KEY` | **secret** | worker |

`NEXT_PUBLIC_*` values are built into the browser bundle: after changing one on Render, trigger a
new deploy (not just a restart).

## 3. Wallets on the live site (Phase 13)

- Wallet linking signs a message containing the site's domain, taken from `APP_URL`. If `APP_URL`
  is wrong, users see the wrong domain in their wallet. Set it before testing linking on Render.
- Phantom and MetaMask must be opened on the Render URL itself (wallet extensions don't work inside
  embedded previews).

## 4. Change log

| Phase | What it added for Render |
|---|---|
| 9 | Program deployed to devnet from WSL (not from Render). `RELAYER_KEYPAIR_JSON` on Render instead of the WSL path. |
| 12 | `APP_URL`, Supabase Site URL and Redirect URLs for the sign-in email link. |
| 13 | Web server now uses `SUPABASE_SERVICE_ROLE_KEY` (wallet linking). `APP_URL` is also the domain shown in the wallet's signing message. |
| 15 | Web needs **`RELAYER_KEYPAIR_JSON`** (secret) for sponsored joins. Keep the relayer funded: it pays fees and Participant rent (~0.002 SOL per join) and stops sponsoring below 0.02 SOL. |
| 14 | Services created (`codestreak`, `codestreak-worker`, free, Singapore) with every non-secret value set. Secrets to add by hand: `SUPABASE_SERVICE_ROLE_KEY` (both), `WORKER_JOB_SECRET` (worker, from Vault). pg_cron wake job every 30 minutes. |
| 20 | No new variables. Invite links are built from **`APP_URL`** (`<APP_URL>/invite/<token>`), so it must be the public Render URL there, or links point at localhost. Migration `private_groups` applied to Supabase. |
| 20 fix | Sign-in links now land on **`/auth/confirm`**. It is covered by the existing Redirect URL `https://codestreak-k0uv.onrender.com/**`; keep that entry (and the Site URL as the Render URL). No new variables. |
| 20 fix 2 | Migration `sign_in_attempts` applied. No new variables. Optional: custom SMTP in Supabase (Authentication → Emails → SMTP) lifts the built-in 2-emails-per-hour project cap. |
