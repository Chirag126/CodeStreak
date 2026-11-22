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

---

## Phase 6: Program: join and sponsor (M)

**Goal:** money can enter a challenge, and only through checked paths. The vault always equals the sum of recorded deposits.

**Added** (`programs/codestreak`)
- **`Participant` PDA** `["participant", challenge, user]`: deposit, join time, day bitmaps (verified / failed / shielded; filled from Phase 7), Shield counters, status (Active → Survived / Failed / Voided later), finalized/claimed flags. Created with `init`, so **a wallet can join a challenge only once**.
- **`join_pool`:**
  - the user signs the token transfer; the relayer (`payer`) pays rent and fees, so users need no SOL;
  - only while the challenge is **Joining** (before the join deadline), and below `max_participants`;
  - **private groups:** the challenge's `join_authority` (CodeStreak's relayer, after it has checked the invite ID or link) must co-sign. A missing co-sign, an impostor co-signer, or the right key listed without its signature all fail;
  - the vault must be the challenge's own vault, the mint and token program must match the challenge, and the source token account must belong to the user;
  - moves exactly the buy-in with `transfer_checked`, then re-reads the vault and requires it grew by exactly that amount (so fee-on-transfer mints can never break accounting);
  - updates `participant_count` and `total_stake` with checked math; emits `ParticipantJoined`.
- **`sponsor_pool`:** anyone adds to the reward pool without participating, from creation until the challenge ends (not during verification or later); amount > 0; private groups need the same co-sign (private sponsor link). Same vault/mint/exact-amount checks. Emits `PoolSponsored`.
- **`SponsorReceipt` PDA** `["sponsor", challenge, sponsor]`: an on-chain receipt that accumulates the total, the number of contributions and first/last times, plus a `refunded` flag for Phase 8 (refunds if a challenge is cancelled or nobody survives). Uses Anchor's `init_if_needed`, guarded so set-up fields are only written on the first contribution.
- **New errors** (appended, codes stable): JoinClosed, PoolFull, JoinAuthorityRequired, InvalidJoinAuthority, InvalidVault, InvalidMint, InvalidTokenProgram, InvalidAmount, SponsorshipClosed, TransferAmountMismatch.

**Tests:** 11 new LiteSVM tests (27 in total), each checking **vault = total_stake + total_sponsor** where funds moved:
- join creates the participant, takes exactly the buy-in, relayer pays;
- 3 joins + 2 sponsorships: vault = 42.5 USDC = recorded totals;
- **double join fails** (no second buy-in taken);
- **late join fails** at the join deadline and after start; one second before still works;
- **private join without co-sign fails**, with an impostor co-signer fails, unsigned co-signer fails; correct co-sign works;
- **wrong vault fails** (another challenge's vault, an attacker's token account; join and sponsor), and no funds move;
- wrong mint fails; paying with someone else's token account fails;
- user signature required; insufficient balance fails without creating a participant;
- pool full fails;
- sponsor receipt accumulates across contributions (also while running); separate receipt per sponsor; sponsors are not participants;
- zero sponsorship, sponsoring after the end, and private sponsoring without co-sign all fail.

---

## Phase 7: Program: verification and Shield (M)

**Goal:** daily results and Streak Shields are recorded on-chain under strict, one-way rules, so the verifier can help users but never take a streak away.

**Added** (`programs/codestreak`)
- **`record_verification(day, result, evidence_hash)`:**
  - only the challenge's **verifier** can sign (the worker's key, copied into each challenge at creation); it pays its own fee and never touches funds;
  - results: **Verified**, **Failed**, or **Indeterminate** (evidence unavailable, e.g. GitHub/LeetCode outage; never counted as a failure);
  - stored as day bitmaps on the Participant (`verified_days`, `failed_days`, new `indeterminate_days`), exactly one bit per day;
  - **one-way rules:** a first result can be anything; Failed or Indeterminate can only be **upgraded to Verified**; a Verified day is final; every other change is rejected;
  - **timing:** only after the day has ended; first results until the verification window closes; upgrades also during the **dispute window**, and nothing after it closes (settlement can rely on final data);
  - the participant account must belong to the challenge (seeds + `has_one`);
  - emits `DayRecorded` with the previous result, whether it was an upgrade, and a SHA-256 `evidence_hash` of the off-chain evidence (commit SHAs, submission IDs) for auditing.
- **`activate_shield(day)`:**
  - the participant signs and pays `shield_price` into the vault (relayer pays the fee); counted in `total_shield`, which goes to the reward pool in Phase 8;
  - allowed from the start of that day until `shield_grace_secs` after it ends, so a day already recorded as Failed can still be rescued within the grace period;
  - rejected if Shields are disabled for the challenge, the per-participant limit is reached, the day is already shielded, or the day is already Verified;
  - only for your own Participant account, paid from your own token account (same vault/mint/exact-amount checks as joining);
  - emits `ShieldActivated`.
- **`rules.rs`:** the transition, timing and Shield rules as pure functions with host unit tests.
- **New errors** (appended): NotVerifier, InvalidDay, DayNotOver, VerificationClosed, VerifiedIsFinal, InvalidTransition, ParticipantMismatch, AlreadyFinalized, ShieldsDisabled, ShieldLimitReached, DayNotStarted, ShieldWindowClosed, DayAlreadyShielded, DayAlreadyVerified.
- **Tests:** shared LiteSVM helpers moved to `tests/common/mod.rs` (used by the Phase 6 and Phase 7 test files).

**Tests:** 4 new unit tests and 11 new LiteSVM tests:
- results stored correctly per day and per participant; the event is emitted; no funds move;
- **non-verifier fails** (relayer, creator, the participant themself, verifier listed without signing);
- **Verified → Failed fails** (and Verified → anything); Failed ↔ Indeterminate and repeats fail; upgrades to Verified work;
- results only after the day ends and only for days in the challenge;
- first results close with the verify window; **upgrades are allowed in the dispute window and fail after it**;
- a participant account from another challenge is rejected;
- Shield paid into the vault and stored (rescues a Failed day within grace); vault = stakes + sponsors + Shields;
- **Shield after grace fails**, before the day starts fails;
- **Shield over the limit fails**, same day twice fails;
- Shield on a Verified day or with Shields disabled fails;
- non-participants, missing signatures and someone else's token account all fail.

---

## Phase 8: Program: settlement and claims (L)

**Goal:** every challenge ends with every token accounted for: survivors are paid, refunds go where they are owed, and the vault ends at exactly 0. Nothing here can be triggered early or twice.

**Added** (`programs/codestreak`)
- **`finalize_participant`** (permissionless, after the dispute window): fixes each participant's outcome from their recorded days.
  - a Shield covers its day whatever was recorded;
  - any uncovered **Failed** day → **Failed** (stake forfeited);
  - otherwise any uncovered **Indeterminate or never-recorded** day → **Voided** (stake back, no reward), so a provider outage or a missed worker run never costs a user money;
  - every day Verified or shielded → **Survived**.
- **`settle_challenge`** (permissionless, once everyone is finalized): fixes the split without moving funds.
  - nobody survived → **full refund** for everyone: stakes, Shield payments and sponsorships;
  - otherwise **R = forfeited stakes + sponsorships + Shield payments**; each survivor gets **stake + ⌊R / S⌋**; the remainder (dust, fewer than S base units) goes to the **last survivor to claim**.
  - refuses challenges below `min_participants` (they must be cancelled and refunded instead).
- **`cancel_pool`:** the creator any time before the start, or anyone once joining has closed with fewer than the minimum participants. After that, joining, sponsoring, verification and Shields are all closed.
- **Claims** (pull-based, one-time flags, paid only to a token account owned by the right wallet; anyone may send the transaction, so the worker can push payouts later):
  - `claim_reward`: survivors;
  - `claim_refund`: participants: stake + Shields if cancelled or nobody survived, stake only if voided;
  - `claim_sponsor_refund`: sponsors, if cancelled or nobody survived. Split out from `claim_refund` because sponsors are identified by their receipt, not a Participant account.
- Funds leave a vault only through `pay_from_vault`, signed by the challenge PDA and used only by the three claim instructions. The backend has no way to withdraw.
- Settlement fields appended to `Challenge` (`full_refund`, `reward_pool`, `reward_per_survivor`, `reward_dust`, `survivors_claimed`, `settled_at`, `cancelled_at`); events `ParticipantFinalized`, `ChallengeSettled`, `ChallengeCancelled`, `PayoutClaimed`.
- **New errors** (appended): TooEarly, NotAllFinalized, AlreadySettled, ChallengeCancelled, BelowMinimumParticipants, NotSettled, NothingToClaim, AlreadyClaimed, CannotCancel.

**Tests:** 4 new unit tests (outcomes, settlement math, payouts and dust, cancel rules) and 9 LiteSVM tests that play each case end to end with real balances. Every case ends with **vault = 0** and total paid out = everything deposited:
1. survivors + a shielded survivor + a failure + sponsor: split with 1 base unit of dust to the last claimer;
2. everyone survives: survivors share the sponsorship;
3. nobody survives: everyone refunded in full (stakes, Shields, sponsorship);
4. voided participants (outage and never-recorded day) get their stake back; the failure funds the survivor;
5. everyone voided: full refund;
6. undersubscribed challenge cancelled by anyone after joining closes: participants and sponsor refunded.
- Also: creator can cancel only before the start; a stranger can't cancel a challenge that met its minimum;
- **early finalize/settle fail**, settle before everyone is finalized fails, **double finalize, double settle and double claim fail**, claims before settlement fail, payouts can't be redirected to another wallet's account, nothing can be recorded/shielded/cancelled after settlement;
- an undersubscribed challenge that ran anyway can't settle and is cancelled and refunded instead.

---

## Phase 9: Devnet deploy and client (M)

**Goal:** the program runs on devnet, the app has a typed client generated from the real IDL, and a script proves the round trip by creating and reading a labeled demo challenge.

**Added**
- **`scripts/wsl/deploy-devnet.sh`** (WSL): checks the RPC's genesis hash is devnet's (not just the URL), restores the program keypair from your key backup if `target/deploy` lost it and checks it matches `A4oh…JT7J`, builds, checks the upgrade authority has enough SOL (~2x the program's rent while deploying; the program is ~507 KB, so ~7.2 SOL), deploys or upgrades with the upgrade-authority key, and uploads the IDL on-chain (Program Metadata) so explorers can decode instructions. An IDL upload failure is reported but does not undo the deploy.
- `fund-devnet.sh`: upgrade-authority target raised from 5 to 8 SOL.
- **IDL in `packages/shared`**: `scripts/sync-idl.mjs` copies `anchor build`'s IDL and its TypeScript type into `packages/shared/src/program/idl/` (generated, not hand-edited). CI fails if the committed IDL differs from the program (`--check`), so the client can never drift from the chain. CI also publishes the IDL as an artifact.
- **Typed client** `@codestreak/shared/program` (`@anchor-lang/core` 1.2 + `@solana/web3.js` 1.x):
  - `createProgram(connection, wallet?)`: read-only without a wallet; `keypairWallet()` for server keys;
  - PDA helpers for config, challenge, vault, participant, sponsor receipt, ProgramData;
  - account/param types from the IDL (`ChallengeAccount`, `InitializePoolParams`, ...);
  - `assertDevnet()` (genesis-hash check), `fetchChallenge()` with phase from the chain clock, a TypeScript mirror of the program's lifecycle (`challengePhase`, `dayIndex`), `rulesHash()` (SHA-256 of canonical rules JSON), Explorer links;
  - handles Anchor's CommonJS-in-Node / ESM-in-browser packaging in one place.
- **`tools/devnet`** workspace package with two scripts (run from Windows):
  - `pnpm devnet:init-config`: one-time Config (admin, default verifier, devnet USDC + wSOL allowed), signed by the upgrade authority; safe to re-run;
  - `pnpm devnet:seed-demo`: creates a **DEMO** challenge (5-minute days, 3 days, 1 USDC buy-in, rules labeled "DEMO – compressed time … no real value", rules hash on-chain, `is_demo` set by the program), then reads it back from devnet and prints every field, the phase and Explorer links.
- **Env:** `check-env` now validates for Phase 9: `NEXT_PUBLIC_CODESTREAK_PROGRAM_ID` (prefilled in `.env.example`) and `RELAYER_KEYPAIR_PATH` are required; new optional, local-only `UPGRADE_AUTHORITY_KEYPAIR_PATH` (never on Render).

**Tests:** client unit tests (program ID, every instruction present, Anchor loads and builds a typed program, u64 seed encoding, distinct off-curve PDAs, lifecycle vectors identical to the Rust tests, key-order-independent rules hash with a known SHA-256 vector) and env-checker tests for the Phase 9 rules. Deploy and the seed script run on devnet from your machine (they need your keys).

**Deployed (2026-11-21), confirmed by running the scripts on devnet:**
- Program `A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J` (upgradeable; authority `4SD3…ZXQR`), ProgramData `7xz9y7tka9m7mLvsMJ9ciUhobNaJYr1m4AQx8cQLELvh`, 507,152 bytes. [Explorer](https://explorer.solana.com/address/A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J?cluster=devnet)
- On-chain IDL (Program Metadata, seed `idl`): `F8sKuQm4YEkjjTr9fEFN4VsiQQCpJVTs9PyCWvchHugH`.
- Config initialized (admin, default verifier, devnet USDC + wSOL).
- Demo challenge `Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2` created by the seed script and read back: DEMO, 3 × 300 s days, 1 USDC buy-in, verifier `4TYd…u7JT`, rules hash on-chain, phase `joining`, vault `4xaPC1yQVGcKvDUM1wpXr1te5RMi8sN8KCPghhpsnTwn` at 0. [Explorer](https://explorer.solana.com/address/Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2?cluster=devnet)
- Note: the npm warning `Unknown project config "node-linker"` during the IDL upload comes from our `.npmrc` (a pnpm setting) being read by `npx`; it is harmless.

---

## Phase 10: Schema A (M)

**Goal:** the app's core tables in Supabase, with the database itself refusing bad money data.

**Added** (`supabase/migrations/20261121180000_schema_a.sql`)
- **Tables:** `profiles` (auto-created for every sign-up, with a personal public ID like `CS-7KQ2M9XA` for private-group invites), `wallets` (one wallet belongs to one profile; at most one primary), `linked_accounts` (one GitHub and one LeetCode per profile; a provider account can't be shared), `challenges` (rules identical to the program's parameters plus the on-chain mirror: address, ID, vault, totals), `memberships`, `invitations` (by public ID or by shareable link, never both), `sponsorships`, `shields`.
- **Money rules in the database:** amounts use a `u64` domain: integer base units, never negative, at most 2^64 − 1. Fractions are rejected (a plain `bigint` would silently round 1.5 to 2). Positive where it must be (buy-in, deposits, sponsorships, Shield prices).
- **Duplicates rejected:** joining twice (by profile or by wallet), counting the same transaction twice (join, sponsorship, Shield, challenge creation), a second Shield for the same day, a wallet or provider account on two profiles, duplicate public IDs/usernames/on-chain challenges, two pending invites to one person.
- **Other checks:** valid Solana addresses and signatures, join deadline ≤ start, Shield settings consistent, day length 60 s…1 day, 1–60 days; `is_demo` is derived (day < 24 h), not writable. All timestamps are `timestamptz` (UTC).
- **Row level security on every table:** browsers can read public challenges and their members; private challenges only if they created, joined or were invited; their own wallets/linked accounts/invitations. Users can edit only presentation fields of their own profile (never `id` or `public_id`). Every other write happens on the server (service role) after checking the chain.
- **CI job** (`database`): applies the migrations to a fresh Postgres 17 (with small stand-ins for Supabase's `auth` schema and API roles) and runs `supabase/tests/schema_a_test.sql`.
- **Applied to the Supabase project** (`qyajonqjjtmlkdxvhloe`) as migration `schema_a`.

**Tests:** 30+ rejected statements (floats as numbers and as text, negatives, zero amounts, u64 overflow, every duplicate above, bad addresses, inconsistent rules, writing `is_demo`) plus RLS checks (anon vs member vs outsider, own-profile edits only, no direct challenge inserts, public ID immutable) and positive checks (profile + public ID per sign-up, full u64 stored exactly, timestamptz).

---

## Phase 11: Schema B and RLS (M)

**Goal:** the verification, money-history and social tables, every one behind RLS, with Supabase's advisors clean.

**Added** (`supabase/migrations/20261122090000_schema_b.sql`)
- **Tables:**
  - `verification_runs`: each worker pass per challenge-day;
  - `evidence`: every commit or accepted submission considered, and why it counted or not. A commit or submission is considered once; the same diff re-pushed under a new SHA never counts twice;
  - `day_results`: mirror of the on-chain result with the program's one-way rules enforced by a trigger (Verified is final; Failed/Indeterminate only upgrade to Verified; member and day can't change);
  - `receipts`: every confirmed on-chain money movement (join, sponsor, Shield, reward, refunds), integer amounts, one per transaction;
  - `disputes`: one open dispute per member-day, a real reason (10+ chars), a resolution required to accept/reject;
  - `audit_log`: append-only (update, delete and truncate blocked);
  - `voice_clips` (ElevenLabs coach), `badge_types` and `badges` (one award per user, badge and challenge; soulbound mint address once minted).
- **Leaderboard views** `challenge_standings` and `leaderboard` with `security_invoker`, so the caller's RLS applies and private groups never leak through a view.
- **RLS on every table**, one SELECT policy each: challenge data for public challenges or members/creator/invitees; receipts, voice clips and audit entries only your own; badges public. All writes go through the server.
- **Advisor fixes for Phase 10:** the visibility helpers moved to a `private` schema the API doesn't expose (no more callable SECURITY DEFINER functions), function search paths pinned, API execute revoked on Supabase's `rls_auto_enable`, indexes on the two unindexed foreign keys.
- **Applied to Supabase** as migration `schema_b`. **Advisors: 0 security findings; performance shows only INFO "unused index"** notes, expected while the database is empty.

**Tests** (`supabase/tests/schema_b_test.sql`, CI `database` job):
- structure: RLS on every table, invoker views, no SECURITY DEFINER function in `public` executable by `anon`;
- one-way results, duplicate evidence/receipts/disputes/badges, fractions and negatives, append-only audit log;
- **two-user RLS:** a non-member can't read the private group through challenges, memberships, runs, evidence, results, disputes or the standings view, and can't write results or disputes; a member sees all of it; anonymous visitors see nothing private; the public challenge and leaderboard stay readable.

---

## Phase 12: Auth and onboarding (M)

**Goal:** sign up with an emailed code, pick a username, land on a dashboard shell, with protected pages guarded on every request.

**Added** (`apps/web`, `packages/shared`)
- **Email OTP sign-in** (`/sign-in`): enter email → a one-time code is emailed (Supabase Auth; the first code creates the account) → enter the code. No passwords. Friendly errors for wrong/expired codes and rate limits.
- **Session proxy** (`src/proxy.ts`, Next.js 16's renamed middleware): refreshes the Supabase session cookie on every request (`getClaims`, which verifies the token) and applies the route guard.
- **Route guard** (`lib/auth/routes.ts`, pure and tested): signed-out users on `/dashboard` or `/onboarding/*` go to sign-in with `?next=` remembered; signed-in users without a username must pick one first; finished users never see sign-in or the username step again. `next` only accepts same-site paths (no open redirects). Misconfigured deployments fail closed.
- **Username step** (`/onboarding/username`): shows the user's **public ID** (generated by the database trigger at sign-up, e.g. `CS-7KQ2M9XA`), live availability hint, and saves as the user (RLS: own row, presentation columns only). Rules shared with the database (`@codestreak/shared` `usernameSchema`: 3–20 of `a-z 0-9 _`, lower-cased, reserved names like `admin`/`codestreak` refused). **Uniqueness is decided by the database**, so two people racing for one name can't both win; the loser sees "That username is taken."
- **Dashboard shell** (`/dashboard`): greeting, email, public ID with copy button, username, sign out, and placeholder cards for challenges, accounts and wallet.
- Header shows **Sign in** or **Dashboard**.
- Supabase clients: browser (`createBrowserClient`), server (`createServerClient` with Next cookies, `server-only`), proxy. All use the publishable key; the service role is never used for user requests.

**Tests:** route guard matrix (signed out / no username / finished × protected / public / auth pages, `next` preserved, open-redirect attempts), username rules (pattern, normalization, reserved names) and the "taken" mapping of the database's unique violation. The database itself rejects duplicate usernames (Phase 10 test).

**Follow-up (email link):** on Supabase's free plan, email templates can't be edited without custom SMTP, and the default emails contain a link, not a code. Added `/auth/callback`, which completes sign-in from that link (`?code=` PKCE, or `?token_hash=&type=` for custom templates) and continues to the username step or the requested page; sign-in passes `emailRedirectTo` (APP_URL locally and on Render). Code entry still works once SMTP with a `{{ .Token }}` template is set up.

**Setup in Supabase:** Authentication → URL Configuration → Redirect URLs: add `http://localhost:3000/**` (and the Render URL in the deploy phase).

---

## Phase 13: Wallet binding (M)

**Goal:** a user proves they own a Solana wallet (Phantom, or MetaMask's Solana account) by signing a single-use message, and it's bound to their profile.

**Added**
- **Wallet Standard picker** (`/dashboard/wallet`): lists every installed wallet that supports Solana, `standard:connect` and `solana:signMessage`, live from the Wallet Standard registry (no wallet-specific code). 0x (Ethereum) accounts are refused with a hint to switch MetaMask to its Solana account.
- **Signed-nonce binding:**
  - server issues a random 128-bit nonce for (user, address), stored in `wallet_nonces`, valid **5 minutes**;
  - the message shows the site domain, the address, the user's public ID, "Solana devnet", the nonce and both times, and says signing is free and moves no funds;
  - server checks: Solana address (32 bytes), not 0x, same address, unchanged message, not expired, not used, valid ed25519 signature (`node:crypto`, `@codestreak/shared/wallet`);
  - the nonce is consumed by one conditional update (`used_at is null and not expired`), so a replayed signature finds nothing;
  - the wallet is inserted with `verified_at`; the first one becomes primary. The database's unique constraint makes **one wallet on two users** impossible, even in a race;
  - link and unlink are written to the audit log. Writes use the service role on the server only, after identifying the user.
- **Network badge** ("Devnet ready" when the wallet reports `solana:devnet`; otherwise a warning to use Phantom for staking) and the global Devnet badge in the header.
- **SOL / USDC balances** (devnet) of the connected or primary wallet, read from the RPC.
- **Devnet setup checklist**, ticked from what the page sees: wallet installed, devnet mode, linked, has SOL, has USDC (with faucet links).
- Dashboard's Wallet card opens the page.
- Migration `wallet_nonces` (RLS on, users read only their own; nonce format, ≤15-minute validity, Solana-only addresses enforced by the database). Applied to Supabase; advisors re-checked.
- **`render.md`:** what is localhost or a laptop file now and what it must be on Render, updated every phase.

**Tests:**
- unit (`@codestreak/shared/wallet`, real ed25519 keys): fresh signature accepted; **replayed nonce**, **expired nonce** (at and after expiry), **0x address**, another wallet, edited message and forged signature all rejected; base58 round trip; every checked field appears in the message.
- SQL (`supabase/tests/wallet_test.sql`): a nonce can be consumed only once; 0x addresses, reused nonces, over-long validity and non-random nonces rejected; **one wallet on two users rejected**; users can't create nonces or link wallets directly and see only their own nonces.

---

## Phase 14: First Render deploy (M)

**Goal:** both services live on Render's free plan, with Supabase waking the worker on a schedule (free Render has no cron).

**Added**
- **Render services** (free, Singapore, auto-deploy from `main`): web **`codestreak`** → https://codestreak-k0uv.onrender.com, worker **`codestreak-worker`** → https://codestreak-worker.onrender.com. Created with every non-secret variable set (cluster, RPC, mints, program ID, Supabase URL and publishable key, operator public keys, `APP_URL`); secrets are added by hand in the dashboard.
- **Health routes:** web `GET /api/health`, worker `GET /health` (both existed; now used by Render).
- **Worker `wake` job** (`apps/worker/src/jobs/wake.ts`): answers the scheduled call and writes a `worker.wake` row to `audit_log` (service role), so every wake is visible in the database.
- **Job endpoint hardening:** the secret is now checked before anything else, so any request to `/jobs/*` without it gets **401** (method and job name are not revealed).
- **`pg_cron` → worker:** migration `worker_wake_cron`: `private.wake_worker(job)` reads `worker_url` and `worker_job_secret` from **Supabase Vault** and POSTs `/jobs/<job>` through `pg_net` (90 s timeout for cold starts); cron job `codestreak-wake-worker` every 30 minutes. The secret is generated inside Supabase, never in the repo or chat. Not callable through the API. In plain Postgres (CI) the schedule part is skipped.
- **`render.md`:** live URLs, build/start commands, health check paths, free-plan budget (750 instance-hours shared by the workspace; the worker sleeps between wakes), how the wake works, and the secrets still to add.

**Tests:** worker server (401 without the secret on any method or job name, 405 only with it), wake job (writes the audit row with the service role, still wakes without Supabase, fails loudly if the write fails). Live checks after the secrets are set: public URL, a `pg_net` call without the secret gets 401, and `cron.job_run_details` + `audit_log` show the worker woke.

---

## Phase 15: Relayer and co-signer (M)

**Goal:** users join with no SOL: CodeStreak's relayer pays the fees and rent, co-signs private joins after checking the invitation, and refuses to pay for anything else.

**Added**
- **Relayer policy** (`@codestreak/shared/relayer`, pure): a relayed transaction must have the relayer as fee payer; contain only compute-budget instructions (≤ 200,000 CU, ≤ 100,000 µlamports priority) and **exactly one** allowlisted CodeStreak instruction (join, sponsor, Shield, claims; never admin, verifier or settlement); no other program at all (no token or SOL transfers); the relayer only as fee payer, rent `payer` or `join_authority`; the user's slot filled by their linked wallet; and no signer other than the relayer and that wallet. Instructions are built straight from the IDL (account order, flags, optional-account placeholder, u64 args).
- **Prepare → sign → submit** (`apps/web/src/lib/relayer/service.ts`):
  - prepare: checks the challenge on-chain (joining open, not already joined), the buy-in balance, the relayer's SOL; for **private challenges** requires the challenge's join authority to be the relayer **and** an invitation in the database before co-signing; builds the transaction with a server-set compute budget, checks the policy, **simulates**, pre-signs, stores it;
  - the wallet adds the user's signature (Wallet Standard `solana:signTransaction`);
  - submit: accepts it only if the message is **byte-for-byte** what the relayer signed (SHA-256), still passes the policy, every signature verifies, the blockhash is still valid and a second **simulation** succeeds; then sends once, confirms, records it and writes the audit log.
- **Idempotency keys:** one UUID per join attempt (`relayer_requests`, unique per user). A retry returns the same prepared transaction or the confirmed signature; a conditional `prepared → submitting` update means a transaction is sent at most once even with concurrent retries.
- **Per-user rate limits:** at most 10 relayer requests per 10 minutes and 60 per day; sponsoring pauses if the relayer drops below 0.02 SOL.
- **Challenge page** `/challenges/[address]`: reads the challenge from devnet (DEMO / private badges, phase, buy-in, dates, vault) with a **Join** button that runs the sponsored flow from the user's linked wallet.
- `pnpm devnet:seed-demo --start-in-minutes=180` keeps joining open longer for testing; it prints the app page link.
- Migration `relayer_requests` (RLS, users read only their own). `render.md`: `RELAYER_KEYPAIR_JSON` required on the web service.

**Tests:** policy: sponsored join and private co-signed join accepted; **attacker token transfer added to the transaction rejected**; SOL drain from the relayer, non-relayed and duplicate program instructions, relayer in the user slot, a foreign co-signer, someone else as the user, another fee payer, and over-cap compute/priority all rejected; u64 argument encoding. **Rate limit: over-limit rejected** (per 10 minutes and per day). SQL: one idempotency key per user, single submission under concurrency, signature required to confirm, users can't write requests.
