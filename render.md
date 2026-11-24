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

**Waking the worker:** Supabase `pg_cron` job `codestreak-verify` (every minute, **only while a challenge has work**: a finished day to record, a pool to cancel or settle, payouts to send) calls `private.wake_worker('verify')`. Supabase `pg_cron` job `codestreak-wake-worker` (every 30 minutes) calls `private.wake_worker('wake')` (and `codestreak-leetcode-snapshots` at :15/:45 calls `private.wake_worker('leetcode-snapshots')`), which POSTs to `<worker_url>/jobs/wake` through `pg_net` with the secret. The URL and secret live in **Supabase Vault** as `worker_url` and `worker_job_secret`. The secret is generated inside Supabase; copy it to the worker's `WORKER_JOB_SECRET` from Supabase → Project Settings → Vault.

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
| `VERIFIER_KEYPAIR_PATH` | `~/.config/codestreak/keys/verifier.json` (WSL) | **don't set**; set **`VERIFIER_KEYPAIR_JSON`** instead: the file's whole contents (a JSON array of 64 numbers). **Required from Phase 28** (recording days, settling, payouts). Get it in WSL with `cat ~/.config/codestreak/keys/verifier.json` | worker | 28 |
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
| `UPGRADE_AUTHORITY_PUBKEY`, `RELAYER_PUBKEY`, `VERIFIER_PUBKEY`, `ADMIN_PUBKEY` | public keys, safe. The worker also needs `VERIFIER_PUBKEY`: it refuses a `VERIFIER_KEYPAIR_JSON` that is a different key | web (worker: `VERIFIER_PUBKEY`) |
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
| 21 | No new variables. Live updates use **Supabase Realtime** (included in the free plan); migration `group_board` adds `challenge_activity` to the `supabase_realtime` publication. Render's free web service is fine: browsers connect to Supabase directly, not to Render. |
| 22 | No new variables. Sponsor links are built from **`APP_URL`** (`<APP_URL>/sponsor/<token>`). Migration `sponsorship` applied. Each first-time sponsor wallet costs the relayer ~0.0016 SOL of receipt rent: keep it funded. |
| Wallet sign-in | No new variables. The sign-in message names the site from **`APP_URL`** (host and origin), so on Render it must be the public URL. Migration `wallet_login` applied. |
| 23 | **One-time setup (dashboards, no env vars):** 1) GitHub → Settings → Developer settings → OAuth Apps → New: Homepage `https://codestreak-k0uv.onrender.com`, Authorization callback `https://qyajonqjjtmlkdxvhloe.supabase.co/auth/v1/callback`. 2) Supabase → Authentication → Sign In / Providers → GitHub: enable, paste Client ID and a new Client secret. 3) Supabase → Authentication → Sign In / Providers (or Settings) → turn on **Allow manual linking**. Redirect URLs already cover `/auth/callback`. Migration `github_linking` applied. |
| 24 | **`GITHUB_API_TOKEN`** (worker, and `.env.local` for `pnpm verify:github`): a fine-grained token with **public repositories read-only** access, no other permissions. Without it GitHub allows only 60 requests/hour. Set it on the **worker** service on Render (secret). No migration. |
| 24 follow-up | **`GITHUB_API_TOKEN`** is now also used by the **web** service (to check selected repositories when a challenge is created): add the same read-only token there as a secret. No migration. |
| Day checks | **`GITHUB_API_TOKEN` on the web service is now required** for "Check now" (each check uses ~5–15 GitHub requests; without a token GitHub allows 60 per hour per server). Migration `member_day_checks` applied. |
| 25 | **`FIRECRAWL_API_KEY` on the web service** (LeetCode Verify reads the profile through Firecrawl; ~1 credit per attempt). Migration `leetcode_binding` applied. |
| 26 | **`FIRECRAWL_API_KEY` on the worker too** (scheduled LeetCode snapshots, ~1 credit per profile per 30 min while a LeetCode challenge runs). pg_cron job `codestreak-leetcode-snapshots` (`:15`/`:45`) → `/jobs/leetcode-snapshots`. Migration `leetcode_snapshots` applied. |
| 27 | No new settings. Migration `day_receipts` applied (receipts table, `member_day_checks.confidence`). |
| fix | **Optional, recommended: custom SMTP** (e.g. Resend or Brevo free tier) in Supabase → Authentication → SMTP. Then paste `supabase/templates/magic-link.html` and `confirm-signup.html` into Authentication → Emails. Makes sign-in links safe from link previews and scanners, and lifts the built-in mailer's limits (2 emails/hour, organisation members only). |
| 28 | Worker needs **`VERIFIER_KEYPAIR_JSON`** (secret, the verifier keypair file's contents) and **`VERIFIER_PUBKEY`**. Without them the `verify` job logs "VERIFIER_KEYPAIR_JSON is not set" and does nothing. **Fund the verifier** with devnet SOL (`solana airdrop 2 <VERIFIER_PUBKEY> --url devnet`): it pays every fee for recording days, finalize/settle and payouts, plus ~0.002 SOL of token-account rent per payout wallet that has none yet (SOL payouts arrive as Wrapped SOL). Migration `verification_job` applied; pg_cron `codestreak-verify` runs every minute but only wakes the worker when there is work. |
| 29 | No new variables. New worker job `reconcile` (reads the chain only, no key needed): pg_cron `codestreak-reconcile` at :05 and :35 → `/jobs/reconcile`. Migration `reconcile` applied. The worker is already awake around those times (wake at :00/:30, LeetCode at :15/:45), so this adds no free-plan hours. |
| 30 | No new variables. The **relayer** (web, `RELAYER_KEYPAIR_JSON`) now also pays fees for "Claim now", for unwrapping SOL, and for the token-account rent when a claim needs one (~0.002 SOL). Keep it funded. Migration `claim_center` applied (relayer_kind `unwrap`). |
| 31 | No new variables. Migration `disputes` applied. **Make yourself an admin** (Supabase SQL editor): `insert into public.admins (profile_id) select id from public.profiles where username = '<your username>';`. The admin page is `/admin/disputes`. Approved disputes are recorded on-chain by the worker (verifier key, Phase 28). |
| 32 | No new variables. Migration `shield_reconcile` applied (`shields.tx_signature` optional, `reconcile_shields`). The relayer also pays fees for Shields. |
| 33 | **ElevenLabs removed**: if `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` were ever set on Render, delete them (nothing reads them). No new variables. Migration `smart_alerts` applied: notifications, triggers, pg_cron `codestreak-deadline-warnings` (every minute, SQL only: it never wakes the worker). Realtime publishes `notifications` (RLS-filtered). |
| 34 | No new variables. **Upgrade the program on devnet** (WSL): `bash scripts/wsl/deploy-devnet.sh`. The build grew ~55 KB, and the script now extends ProgramData first, so the upgrade authority needs ~0.4 SOL more rent plus the usual ~2× program rent during deploy. Migration `soulbound_badges` applied. The **verifier** pays each badge's rent (~0.004 SOL, mint + token account): keep it funded. Until the upgrade, badge mints fail with an unknown instruction and are retried every 10 minutes. |
| 35 | No new variables and no migration. New web dependency **recharts** (installed by the normal build). Audio cues are generated in the browser (Web Audio API), with no audio service. |
