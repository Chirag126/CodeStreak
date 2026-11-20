# CodeStreak build log

One entry per roadmap phase: what was done, what was added, what was achieved, how it was tested, and what was learned. Newest phase last. Updated at the end of every phase.

**Project:** on-chain coding accountability arena on Solana **devnet** (tokens have no real value).
**Plan:** 46 phases over 5 days, solo. M = must, S = should.

| # | Phase | Status | PR |
|---|---|---|---|
| 1 | Accounts, toolchain, keys, secret safety | ✅ Done | [#1](https://github.com/Chirag126/CodeStreak/pull/1) (+ fixes in [#2](https://github.com/Chirag126/CodeStreak/pull/2)) |
| 2 | Risk spikes: wallet co-signing, GitHub, LeetCode | ✅ Done | [#2](https://github.com/Chirag126/CodeStreak/pull/2), [#3](https://github.com/Chirag126/CodeStreak/pull/3) |
| 3 | Monorepo scaffold + CI | ✅ Done | [#4](https://github.com/Chirag126/CodeStreak/pull/4), [#5](https://github.com/Chirag126/CodeStreak/pull/5) |
| 4 | Design system and motion | ✅ Done | [#6](https://github.com/Chirag126/CodeStreak/pull/6) |
| 5 | Program: config and pool creation | 🟡 In review | [#7](https://github.com/Chirag126/CodeStreak/pull/7) |
| 6 | Program: join and sponsor | ⏳ Next | |

---

## Phase 1: Accounts, toolchain and keys (M)

**Goal:** a machine that can build everything, four separate operator keys, and no way for secrets to reach git.

**Added**
- `.env.example`: every variable, grouped and labeled with the phase that needs it (devnet only).
- `scripts/check-env.mjs` (`pnpm check:env`): validates `.env.local`. Rejects mainnet URLs, secrets in `NEXT_PUBLIC_*` and duplicate operator keys; later-phase variables show as `LATER`.
- `scripts/check-secrets.mjs` + `.githooks/pre-commit`: blocks keypairs, base58 secret keys, PEM keys, GitHub/Supabase/Firecrawl/`sk_` keys, RPC API keys and `.env*` files from being committed.
- `scripts/wsl/generate-keys.sh`: `upgrade-authority`, `relayer`, `verifier`, `admin` in `~/.config/codestreak/keys` (outside the repo, `chmod 600`).
- `scripts/wsl/fund-devnet.sh`: idempotent devnet SOL top-ups; `--wallet` funds a user wallet; refuses mainnet.
- `scripts/wsl/doctor.sh`, `scripts/doctor.ps1` (`pnpm check:setup`): one-command machine check.

**Achieved:** Rust 1.97.1, Solana CLI 3.1.10, Anchor 1.1.2, Node 26 (Windows) / 24 (WSL), pnpm 10.34.7. Four funded keys, Supabase project, GitHub token, Firecrawl key. `check:env` reports 0 errors.

**Tests:** 20 `node:test` tests, including a real git-hook integration test (blocks a fake token and `.env.local`).

**Bugs found and fixed:** `pnpm doctor` is a built-in pnpm command (renamed to `check:setup`); Windows → WSL path lost its backslashes; trailing space in `solana config get` output.

**Open:** repo still has a copy inside OneDrive (recommended location: `C:\dev\CodeStreak`). Upgrade-authority key needs ≥5 SOL before Phase 9.

---

## Phase 2: Risk spikes (M)

**Goal:** prove the three riskiest assumptions against real services before building on them.

**Added:** `spikes/` (not shipped): `cosign` (wallet + relayer test page), `github` (push → diff evidence), `leetcode` (Firecrawl profile parsing).

**Achieved**
- **Wallet co-signing works** with Phantom on devnet: signed-message ownership proof verified; memo and USDC transactions with the **relayer as fee payer** confirmed on devnet.
- **GitHub evidence works:** PushEvent → Compare → Commit API gives real per-file diffs (16 API calls for 3 pushes).
- **LeetCode via Firecrawl works:** live scrape, 1 credit, solved count + profile summary + Recent AC list with submission IDs.

**Learned (changes to the plan)**
- Phantom adds priority-fee instructions to unsigned transactions. **Fix:** the server sets the compute budget and the **relayer signs first**. This is the Phase 15 pattern.
- MetaMask registers natively but this build cannot select Solana Devnet. **Phantom is the recommended devnet wallet**; MetaMask stays supported through the same Wallet Standard code. Onboarding needs an explicit "switch to Devnet" step.
- Firecrawl caches up to 2 days by default: verification always sends `maxAge: 0`.
- LeetCode submission IDs strictly increase, so new solves are detected **by ID**, not by "3 days ago" text.
- GitHub push events no longer include commits (`before, head, push_id, ref, repository_id` only).
- **Cheating holes found in real data:**
  - merge commits repeat the merged diff;
  - the same commit appears in several pushes;
  - identical changes show up under different SHAs;
  - commits from unlinked emails have no author id.

**Tests:** 9 new unit tests (29 total); parser validated on a real profile; mocked end-to-end runs; live runs by the user.

---

## Phase 3: Monorepo scaffold + CI (M)

**Goal:** one workspace where the web app, the worker, the Solana program and shared code build and are checked automatically.

**Added**
- **pnpm workspace:** `apps/web`, `apps/worker`, `packages/shared`; Anchor workspace in `programs/codestreak`. `spikes/` stays outside the workspace.
- **`packages/shared`:**
  - constants (devnet, mints, decimals, durations, verification states);
  - **money as integer base units** (`parseAmount`/`formatAmount`, no floats);
  - **UTC day math** with compressed demo days;
  - **zod env schemas** (public / web server / worker) that never print values;
  - **verification rules**: GitHub with all Phase 2 holes closed, and the LeetCode parser with snapshot diff.
- **`apps/worker`:** framework-free HTTP service. Public `/health`, and `POST /jobs/:name` protected by `WORKER_JOB_SECRET` (constant-time compare). Never runs the same job twice at once. Ready to be woken by Supabase `pg_cron` on Render's free plan.
- **`apps/web`:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, ESLint flat config, validated env, `/api/health`, scaffold home page. Reads the single root `.env.local`.
- **`programs/codestreak`:** Anchor 1.1.2 program (`ping` instruction) pinned to Solana 3.1.10.
- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), TypeScript 5.9 pinned (TS 7 exists, but typescript-eslint and Next.js need TypeScript's JS API).
- **One command for everything:** `pnpm check` = secret scan → typecheck → lint → test → build.
- **GitHub Actions CI** on every PR and push to `main`:
  - TypeScript job: `pnpm check`.
  - Program job: `anchor build` using the same Solana installer as local setup.

**GitHub rules now enforced in code (from Phase 2 real data)**
1. Merge commits never count.
2. A commit counts once even if it appears in several pushes.
3. Identical changes count once even under different SHAs, paths or repos (content hash of meaningful lines).
4. Only commits whose GitHub author id is the user's count.
5. Only the user's own non-fork repos count (MVP).
6. The day is decided by **push time**, never the author date.
7. Only meaningful lines in eligible source files count; bulk commits are flagged, not failed.

**Tests:** 26 shared tests (GitHub rules incl. each Phase 2 finding, LeetCode, money, UTC time) + 6 worker server tests run green locally; env schema tests and everything else run in CI.

**Achieved**
- **CI green on the first run** (PR #4):
  - TypeScript job: real `pnpm install`, then typecheck, lint, all tests (incl. the zod env tests), Next.js production build (compiled in 3.7 s).
  - Program job: `anchor build` with **anchor-cli 1.1.2 + solana-cli 3.1.10**, the same versions as the local machine (the installer pins them).
- Found by CI and fixed: Anchor 1.x's `#[program]` macro checks the `custom-heap` / `custom-panic` features, so they are now declared in `Cargo.toml` (no more unexpected-cfg warnings).
- Still to confirm on the user's machine: `pnpm check`, `anchor build`, `anchor keys sync`.

**Windows install fix:** `pnpm install` failed with `ERR_PNPM_EPERM ... symlink` in `C:\dev\CodeStreak` (folder permissions refuse the links pnpm's default layout creates). Added `.npmrc` with `node-linker=hoisted`: a flat npm-style `node_modules`, the same on Windows, WSL and CI.

**Done on the user's machine:** `pnpm check` passes; `anchor build` + `anchor keys sync` → real program ID **`A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J`** committed with `pnpm-lock.yaml` and `Cargo.lock`; program keypair backed up to `~/.config/codestreak/keys/program-keypair.json`.

**Open:** CI still installs with `--no-frozen-lockfile` because PRs that add dependencies can't update the lockfile from the build environment; the user commits the updated lockfile after each such PR.

---

## Phase 4: Design system and motion (M)

**Goal:** one visual language every later screen is built from: tokens, typography, components, motion and an app shell, all accessible.

**Added**
- **Tokens** (`src/design/tokens.ts`, the single source of truth):
  - charcoal surfaces (950 → 100), electric green (primary/success), cobalt (accent/links), danger, warning;
  - shadcn-style semantic roles (`background`, `primary`, `muted-foreground`, …).
- **Contrast enforced in CI:** 21 foreground/background pairs with their WCAG minimum (7:1 body, 4.5:1 text, 3:1 input borders/focus ring) in `tokens.test.ts`. Another test fails if `globals.css` drifts from `tokens.ts`.
  - Palette choices made by measurement: white on the original cobalt `#3b6ef6` was 4.42:1, so cobalt buttons use `#2c5be0` (5.71:1). Input borders moved to `#646e80`, the first gray at ≥3:1 on every surface.
- **Tailwind 4 theme** (`globals.css`): palette, semantic roles, radii, Geist / Geist Mono fonts, shimmer animation, `bg-dots` and `surface-glass` utilities.
- **Components** (`src/components/ui`, shadcn/ui v4 conventions on the `radix-ui` package): Button (7 variants, 4 sizes, loading, `asChild`), Badge (7 variants), Card (+ header/title/description/action/content/footer), Input (invalid state), Label, Separator, Skeleton, Switch, Tabs, Tooltip, Progress, Avatar, Dialog + side Sheet, plus CodeStreak pieces **Stat** (KPI tile) and **TokenAmount** (exact bigint amounts).
- **Motion** (`motion` package, formerly Framer Motion):
  - `src/lib/motion.ts` presets: durations, easings, springs, `fadeIn` / `fadeUp` / `scaleIn`, stagger;
  - `motionSafe()` strips movement but keeps fades;
  - components: `Reveal`, `Stagger` / `StaggerItem`, `AnimatedNumber`.
- **Reduced motion, three layers:**
  1. OS setting respected by default.
  2. In-app toggle (System / Reduced / Full), saved in localStorage and synced across tabs.
  3. The choice applies to Motion components (`MotionConfig`) **and** CSS animations/transitions (`html[data-motion]`), even if the OS says otherwise.
- **App shell:**
  - sticky glass header: logo, nav with an animated active pill, Devnet badge with tooltip, mobile sheet menu;
  - footer: devnet notice, animation toggle, source link;
  - skip-to-content link.
  - Nav lists only routes that exist (no dead links).
- **`/styleguide`** (dev only, 404 in production, `noindex`): every token with its hex, a live contrast table, typography, all component states, working interactions (loading button, invalid input, switch, tabs, tooltip, dialog, progress), and motion demos with replay.

**Tests:** 71 web tests (contrast pairs, CSS↔token sync, motion presets) pass locally; CI runs them with typecheck, lint and the Next.js build.

---

## Phase 5: Program: config and pool creation (M)

**Goal:** the first real on-chain logic. A global config, and challenge pools that each own a token vault only the program can move funds from.

**Added** (`programs/codestreak`)
- **`Config` PDA** `["config"]`: `admin`, `default_verifier`, `allowed_mints` (max 4; devnet USDC and wrapped SOL in production).
- **`initialize_config`:** one-time, and **only the program's upgrade authority** (the deploy key) can run it, so nobody can grab admin rights between deployment and setup. The admin can be a different key (the `admin` operator key).
- **`update_config`** (admin only): allowed mints (no duplicates), default verifier, admin rotation. Existing challenges are never affected: each keeps its own verifier copy and its mint is fixed.
- **`initialize_pool`:**
  - creates the **`Challenge` PDA** `["challenge", creator, challenge_id]` and its **vault** `["vault", challenge]`, an SPL token account whose authority is the challenge PDA;
  - `payer` (the relayer) and `creator` are separate signers, so users don't need SOL for rent;
  - works with classic SPL Token and Token-2022 mints (`token_interface`).
- **Stored fields:** buy-in in base units; start; `day_length_secs` (86,400 real, 60+ for **demo** challenges, flagged `is_demo`); number of days; join deadline; participant limits; Shield price/limit/grace; verification and dispute windows; private-group `join_authority`; `rules_hash` of the published rules; zeroed counters for later phases.
- **Lifecycle derived from the clock**, so no transaction is needed to move a challenge forward. Only Open / Cancelled / Settled are stored:
  `Joining → Starting → Active → Verifying → DisputeWindow → AwaitingSettlement`, plus `Settled` / `Cancelled`. `day_index(now)` gives the current challenge day.
- **Validation** (pure function, host-tested): buy-in > 0; day length 60 s…1 day; 1–60 days; start in the future (≤ 90 days ahead); join deadline in the future and ≤ start; 2 ≤ min ≤ max ≤ 1,000 participants; windows 1 min…7 days; consistent Shield settings; all time math overflow-checked.
- **Events:** `ConfigInitialized`, `ConfigUpdated`, `PoolCreated` (for the indexer and UI).
- **CI:** the program job now runs `cargo test -p codestreak` after `anchor build`.

**Tests (16, all green in CI)**
- 7 unit tests: every lifecycle phase boundary, stored states overriding the clock, day index, every validation rule, demo-length days, Shields on/off.
- 9 LiteSVM tests against the compiled program (in-process Solana VM):
  - pool + vault created with the relayer paying (creator's SOL untouched; vault owned by the token program, authority = challenge PDA, balance 0);
  - private pool stores its join authority;
  - lifecycle phases as time moves;
  - wrong mint rejected; every invalid parameter rejected with its named error;
  - duplicate challenge ID rejected; challenge can't be created without the creator's signature;
  - a stranger can't initialize the config;
  - only the admin can update the config (duplicate mints rejected), and a newly allowed mint becomes usable.

**Learned:** Anchor 1.x's `anchor build` also compiles integration tests during its IDL step, so test compile errors surface as "Building IDL failed".
