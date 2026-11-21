# Render deployment notes

Everything runs on Render's **free plan**: a web service (Next.js app) and a worker web service
(Supabase `pg_cron` + `pg_net` wake it, because the free plan has no cron jobs or background workers).

This file is updated every phase. It lists what currently points at **localhost** or at files on
your laptop, and what each value must be on Render. Never commit real secret values: set them in
Render → Service → Environment.

## 1. Values that change on Render

| Variable / setting | Local value now | On Render | Service | Since |
|---|---|---|---|---|
| `APP_URL` | `http://localhost:3000` | `https://<web-service>.onrender.com` (no trailing slash) | web | 1 (used from 12) |
| Supabase → Auth → URL Configuration → **Site URL** | `http://localhost:3000` | `https://<web-service>.onrender.com` | Supabase dashboard | 12 |
| Supabase → Auth → URL Configuration → **Redirect URLs** | `http://localhost:3000/**` | add `https://<web-service>.onrender.com/**` (keep localhost for development) | Supabase dashboard | 12 |
| `RELAYER_KEYPAIR_PATH` | `\\wsl$\Ubuntu\home\chirag_126\.config\codestreak\keys\relayer.json` | **don't set**; set `RELAYER_KEYPAIR_JSON` instead (the file's contents, a JSON array of 64 numbers) | web | 9 |
| `UPGRADE_AUTHORITY_KEYPAIR_PATH` | path to `upgrade-authority.json` | **never set on Render** (local, one-time scripts only) | - | 9 |
| `VERIFIER_KEYPAIR_PATH` | (not used yet) | **don't set**; set `VERIFIER_KEYPAIR_JSON` instead | worker | 28 |
| `WORKER_URL` | (not used yet) | `https://<worker-service>.onrender.com` | web, Supabase cron | 14 |

## 2. Values that stay the same on Render

Copy these from your `.env.local` as they are.

| Variable | Notes | Service |
|---|---|---|
| `SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_CLUSTER` | always `devnet` (mainnet is rejected) | web, worker |
| `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | devnet RPC. The public one is rate-limited; a Helius devnet URL is better for the demo | web, worker |
| `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_WSOL_MINT` | devnet USDC / native mint | web |
| `NEXT_PUBLIC_CODESTREAK_PROGRAM_ID` | `A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J` | web |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same project | web, worker |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret**. Used by the web server from Phase 13 (wallet linking) | web, worker |
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
