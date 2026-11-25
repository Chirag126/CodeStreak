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
- **CI job** (`database`): applies the migrations to a fresh Postgres 17 (with small stand-ins for Supabase's `auth` schema and API roles) and runs `supabase/tests/10_schema_a_test.sql`.
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
  - `voice_clips` (planned ElevenLabs coach; removed in Phase 33), `badge_types` and `badges` (one award per user, badge and challenge; soulbound mint address once minted).
- **Leaderboard views** `challenge_standings` and `leaderboard` with `security_invoker`, so the caller's RLS applies and private groups never leak through a view.
- **RLS on every table**, one SELECT policy each: challenge data for public challenges or members/creator/invitees; receipts, voice clips (removed in Phase 33) and audit entries only your own; badges public. All writes go through the server.
- **Advisor fixes for Phase 10:** the visibility helpers moved to a `private` schema the API doesn't expose (no more callable SECURITY DEFINER functions), function search paths pinned, API execute revoked on Supabase's `rls_auto_enable`, indexes on the two unindexed foreign keys.
- **Applied to Supabase** as migration `schema_b`. **Advisors: 0 security findings; performance shows only INFO "unused index"** notes, expected while the database is empty.

**Tests** (`supabase/tests/20_schema_b_test.sql`, CI `database` job):
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
- SQL (`supabase/tests/30_wallet_test.sql`): a nonce can be consumed only once; 0x addresses, reused nonces, over-long validity and non-random nonces rejected; **one wallet on two users rejected**; users can't create nonces or link wallets directly and see only their own nonces.

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
- SQL test files are numbered (`10_`, `20_`, ...) so CI runs them in phase order: each file's fixtures assume the earlier ones ran first.

---

## Phase 16: Transaction UX kit (M)

**Goal:** every on-chain action shows clear progress and a clear result, and every failure reads like a sentence, not a stack trace.

**Added**
- **Stepper** (`components/tx`): Prepare → Approve → Confirm, driven by a pure reducer (`txFlowReducer`) and `useTxFlow()`: each step shows pending / working (spinner + hint) / done / failed, animated with Motion (reduced-motion respected), with the result underneath: "Confirmed on devnet · View on Explorer" or the error's headline and explanation. Announced to screen readers.
- **Animated toasts** (`components/feedback/toaster.tsx`, in the app providers): success / error / info, spring in, slide out, auto-dismiss (errors stay longer and use `role="alert"`), optional Explorer link, dismiss button, at most 4 at a time.
- **Explorer links** for every confirmed transaction (stepper and toast).
- **Error mapping** (`@codestreak/shared/errors`, a light subpath the browser can load): `friendlyTxError()` turns anything into `{ code, title, message }`:
  - wallet **rejected signature** (code 4001 or any "rejected / declined / cancelled" wording) → "Cancelled in your wallet: nothing was sent and nothing was charged";
  - **failed simulation**: the Anchor `Error Code:` in the logs, or a numeric custom error (hex or JSON), is looked up in the IDL's 47 program errors, with friendlier wording for the ones users hit (joining closed, full, private group, Shield window, already claimed, ...);
  - Anchor constraint failures, missing tokens / SOL, expired blockhash, network trouble, and a safe fallback.
  The relayer now returns these codes and headlines with every refusal.
- **Join button** rebuilt on the kit (stepper + toasts); "Try again" after a failure reuses the idempotency key.
- **DB sync** (`lib/sync/chain.ts`): after a confirmed join the server mirrors, from the chain only, the challenge (inserted on first sight, refreshed after), the membership (Participant PDA, deposit, status, join tx) and a `join` receipt. Idempotent (upserts; a receipt per transaction). A sync failure is logged, never shown as a failed join, since the chain is already final. Migration `chain_sync`: `challenges.creator_id` may be null for challenges created outside the app (scripts, demo seed).

**Tests:** error mapping (rejected signature in several wallet wordings; failed simulation from Anchor logs; hex and JSON custom codes through the IDL; missing tokens / SOL; constraint failures; expiry; network; every program error has text). Stepper reducer (full happy path with signature; the failing step is marked and keeps the friendly error; a failed simulation fails the first step; a retry starts clean; no progress after the end). SQL: challenges created outside the app sync, one row per on-chain challenge, re-sync updates it.

---

## Phase 17: Create-challenge wizard (M)

**Goal:** anyone signed in can create a public or private challenge from the app; the pool and vault are created on-chain (sponsored) and the app row is written with the details.

**Added**
- **Wizard** at `/challenges/new` (signed-in only), 6 steps with animated transitions: **Basics** (title, description, public / private group), **Stake** (USDC or SOL, buy-in), **Schedule** (real time: 3 / 7 / 14 / 30 days from a UTC start date; or **demo mode**: 3 compressed days of 2 / 5 / 10 minutes starting 10–120 minutes from now, labeled DEMO), **Rules** (GitHub and/or LeetCode, **ANY / ALL**, minimum meaningful lines), **Players & Shields** (minimum / maximum players, Shields on/off, price, per-player count, grace), **Review** with the build → sign → confirm stepper.
- **One set of rules, three places** (`@codestreak/shared` `challenge-form.ts`): the zod form schema (with cross-field rules: buy-in limits per token, ≤ 6/9 decimals, max ≥ min players, Shield price > 0 and ≤ buy-in, grace ≤ one day), `toPoolParams()` (form → program parameters; Shields off sends zeros as the program requires), and `validatePoolParams()`, a line-by-line mirror of the program's `validate_pool_params`. The wizard blocks each step client-side; the server re-validates everything at **chain time**; the program checks again. Every refusal points at the field.
- **Sponsored creation:** the relayer service is now generic (`prepareRelayed` for any allowlisted kind). `prepareCreate` builds `initialize_pool` with the user's linked wallet as **creator** and the relayer paying rent for the Challenge and vault; private groups name the relayer as join authority (it co-signs joins only after the invitation check). Same policy, simulation, idempotency, rate limits and byte-for-byte submit check as joins. `initialize_pool` added to the relayer allowlist.
- **Rules document:** providers, ANY/ALL, line threshold, stake and mode; its SHA-256 (canonical JSON) is the on-chain `rules_hash`, and exactly that document is stored in `challenges.rules`.
- **DB row:** on confirmation the challenge is mirrored from the chain and the app details (title, description, rules, creator profile, create transaction) are written. Migration `create_challenge`: relayer kind `create`, `relayer_requests.payload` for the details.
- Dashboard "Your challenges" → **Create a challenge**; challenge page shows the title and description from the database.

**Tests:** form validation (real and demo accepted with correct parameters; SOL decimals; 20 invalid inputs each blocked on the right field, including past / too-far start, bad amounts, player limits, Shield price and grace), Shields-off zeros, the program-rule mirror (every error), the rules document (ANY/ALL, providers); route guard protects `/challenges/new` while challenge pages stay public.

---

## Phase 18: Challenge list and detail (M)

**Goal:** browse real devnet challenges, see how each pool stands, and know what you could win, with the estimate computed exactly as the program will.

**Design**
- **List reads the database mirror** (fast, filterable, RLS-scoped); **detail reads the chain live** (source of truth for money and players) and refreshes the mirror **after the response** when it is more than a minute old, so challenges joined outside the app catch up without slowing the page.
- **One stats view**, `challenge_overview` (security invoker: private groups appear only to their creator, members and invitees): end time, pool size (stakes + sponsorships + Shields), members, players still in (no failed day that isn't covered by a Shield), survivors, finalized.
- **Payout math mirrors the program** (`@codestreak/shared` `payout.ts`): `computeSettlement` is `compute_settlement` + `reward_amount` in bigint (no floats); the estimate applies it to the live pool.

**Added**
- **`/challenges`** (in the header nav): cards with status (joining open / starting soon / running / finished / cancelled), **DEMO** and Private badges, buy-in, **pool size**, players / max, **survival rate**, length and a relative time. **Filters** as shareable links (status, token, length incl. demo) and a title search (GET form, works without JavaScript); joining-open challenges sort by closing time. Empty and error states.
- **Detail page:** "Live from devnet" badge; buy-in, pool, players (min/max), survival rate, length, dates, sponsorship total; **rules card** (what counts each day from the stored rules document, Shield terms, and the **payout formula**: R = forfeited stakes + sponsorships + Shields; survivor gets stake + ⌊R ÷ survivors⌋; dust to the last claimer; nobody survives → full refund; unverifiable day → stake back; too few players → cancelled and refunded); **reward estimate** with a survival-rate slider ("If 70% keep their streak: each survivor gets X, profit +Y"), counting you as a player while joining is open; **players** with verified / missed days and Shields; "You are in this challenge" instead of Join once joined.
- Migration `challenge_overview` (view + indexes on join deadline and pool state). Applied to Supabase.

**Tests:** the settlement mirror against the program's own fixtures (`rules.rs` settlement_math: R 31, share 15, dust 1; `settlement.rs` cases 1–5 including the 13.000001 pool split 6.5 + 1 base unit of dust, full refunds and voided stakes), the estimate (10 players, 70% → 4.285714 USDC per survivor, 2 units of dust; sponsorship-only pools; rate clamping), survival rate and status rules. SQL: pool size, end time, players still in (a shielded failure stays in), and RLS through the view (a non-member doesn't see the private challenge; the creator does).

---

## Phase 19: Join flow (M)

**Goal:** join with devnet USDC or SOL from the app, with balances, closed challenges and full pools handled before anything is signed, and memberships kept in sync.

**Design**
- **SOL join = one transaction:** the program only takes token accounts, so the stake is wrapped in the same transaction: [create the user's wSOL account] → move the stake into it → sync → join → [close the account again, returning its rent]. Already-wrapped wSOL is used first; only the rest is wrapped. The user pays only the stake; the relayer still pays the fees.
- **The relayer policy widened narrowly:** these four instruction shapes are accepted only for SOL joins (`wrap` context, decided by the server and stored with the request so submit applies the same rule), only for the user's own wSOL account, SOL only from the user's wallet into it and at most the buy-in, never paid or signed by the relayer, and in order (wrap before the join, close after). Everything else (a transfer anywhere else, the relayer paying the account, closing to someone else) is still refused.
- **Membership sync:** after a confirmed join (Phase 16) and now also when a challenge page is refreshed: every on-chain Participant whose wallet is linked to a profile is mirrored, so joins made outside the app show up.

**Added**
- `@codestreak/shared/relayer`: wSOL instruction builders, wrap-aware policy, `planSolWrap()` (what to wrap and how much SOL is needed).
- Join (`lib/relayer/service.ts`): USDC and SOL paths. Handled cleanly before signing, with plain messages: **not enough USDC** ("buy-in is 5 USDC and your wallet has 2", faucet link), **not enough SOL** (stake + refundable deposit), **joining closed**, **challenge full**, already joined, private without invitation. Race conditions still end in the friendly program errors from Phase 16.
- Join button explains SOL wrapping in one line.
- `pnpm devnet:seed-demo --token=sol` (0.05 SOL demo challenge).
- **`pnpm devnet:close-challenges [--dry-run]`:** cancels every challenge the program allows (relayer-created before start; anyone's once joining closed under the minimum), refunds every participant and sponsor of cancelled challenges to their own token accounts (creating them if needed), marks them cancelled in the app, and reports challenges that cannot be cancelled (started with enough players: they must finish and settle).

**Tests:** SOL join with create → wrap → sync → join → close accepted; wrap instructions without a SOL stake, SOL to anyone but the wSOL account, more than the buy-in, the relayer funding or paying, closing to an attacker, wrapping after the join or closing before it, and an attacker token transfer all rejected; the wrap plan (new account needs stake + rent; existing wSOL is used first; insufficient balance detected).

---

## Phase 20: Private groups (M)

**Goal:** invite friends by public ID or by link, let them accept or decline, and keep private groups visible and joinable only by members and invited people.

**Design**
- **Links are hashed and short-lived.** A link carries 256 random bits, shown once to the creator; the database keeps only their SHA-256, so a database leak yields no working links. Every link expires (default 3 days, at most 30 and never after joining closes) and has a use limit (single-use by default, up to 20).
- **Opening a link consumes nothing.** `/invite/<token>` only previews the group; a use is spent by the "Accept invitation" button (a POST), so chat-app link previews and crawlers can't burn single-use links. The page is `noindex`.
- **Atomic redemption:** a conditional update that succeeds only if the link is still pending, unexpired and the use count is unchanged (retried on a race), then an accepted invitation is recorded with `via_link`. Someone already invited or the creator doesn't spend a use.
- **By public ID:** the creator types a friend's ID (forgiving input: `cs-7kq2 m9xa` works); the friend gets a pending invitation on their dashboard to accept or decline. **Declining hides the group again** (RLS only counts pending and accepted invitations).
- **Visibility** stays enforced by RLS (`private.can_view_challenge`). Outsiders opening a private group's page see only "This group is invite-only": no title, rules or players. The on-chain account is public by nature; the app just doesn't surface it.
- **Joining:** the program requires the join-authority co-signature for private pools and the relayer gives it only to people with a live invitation, so an uninvited wallet can't join even by calling the program directly. A confirmed join marks the invitation accepted.
- **Start when the minimum is reached:** the page shows "x of min needed, starts once n more join by the deadline; otherwise everyone is refunded" (the program cancels under-minimum pools after the deadline; `devnet:close-challenges` refunds them).

**Added**
- Migration `private_groups`: `declined` status; `code` replaced by `code_hash` (64 hex, unique); links must have expiry and use limit; lifetime ≤ 30 days; `via_link`; one live (pending or accepted) invitation per person per group. Applied to Supabase.
- `@codestreak/shared`: `normalizePublicId`, `inviteLinkProblem`, `invitationAllowsJoin`, `INVITE_LINK_LIMITS`.
- `lib/groups/invites.ts` (server only): invite by ID, create/revoke links, accept/decline, preview, redeem, lists. All creator actions check the viewer created the private group and joining is still open; every action is audit-logged.
- Creator's **Invite friends** panel on the group page (by ID, link with uses/expiry and copy, invitation list with status and revoke); dashboard **Invitations** card with Accept/Decline; `/invite/[token]` page.

**Tests:** SQL: a raw token instead of a hash, links without expiry or use limit, links living over 30 days, a duplicate hash, a reused link (uses beyond the limit), a second live invitation and `via_link` on a link row are all rejected; an outsider sees neither the group, its overview nor its invitations; the friend invited by ID and the person who redeemed a link see it; declining hides it again; re-inviting after a decline works. Unit: expired (at and after expiry), used-up and revoked links; only pending/accepted invitations allow joining; public ID normalization.

### Phase 20 fix: sign-in link works in any browser

**Problem:** a friend opening the sign-in email on another device or in the email app's browser came back to the sign-in page every time (auth logs: the link verified, then the session exchange failed). Supabase's default PKCE flow needs a verifier cookie that exists only in the browser that requested the email. The free-plan email has no code to fall back on, so they could never sign in.

**Fix:** the email is now sent with the implicit flow and lands on `/auth/confirm`. The session arrives in the URL fragment, which is never sent to a server, and is stored as the usual cookie, so the link works in any browser. The fragment is wiped from history at once, and the route guard continues to the username step or the invite page. Safety nets: tokens or errors landing on any other page are forwarded to `/auth/confirm`, and an old `?code=` link landing anywhere is forwarded to `/auth/callback`. Expired or already-used links say "only the newest link works". The code box stays for emails that show a code.

### Phase 20 fix: sign-in tries and wait timer

- **3 tries per email, then a countdown.** Each address may request 3 sign-in emails and enter 3 wrong codes per 15 minutes; after that the button shows "Try again in m:ss" and stays off until the oldest try expires. Attempts are kept server-side in `sign_in_attempts` with only a SHA-256 of the email (RLS on, no policies: invisible to users), pruned after a day. If the lookup fails, sign-in still works (fails open).
- **Supabase's own limits get the same timer** instead of a vague "too many attempts": the per-address resend interval uses its exact seconds; the project-wide email allowance (`over_email_send_rate_limit`, the real cause seen in the auth logs) shows a 15-minute wait.
- **Known limit (free plan):** Supabase's built-in email sender allows only 2 emails per hour for the whole project. A free custom SMTP provider removes this (dashboard setting; also makes the email templates editable, so the email can carry a code).

---

## Phase 21: Group dashboard (M)

**Goal:** a live board for every challenge: who is in, today's status, the pool and the next deadline, updating in every open browser without a refresh, and recovering by itself after going offline.

**Design**
- **Realtime carries a signal, not data.** A one-row-per-challenge `challenge_activity` table has a version that triggers bump whenever members, day results, Shields, checks or the challenge change. Browsers subscribe to their challenge's row with Supabase Realtime, which applies the same RLS as reads, so an outsider never receives a private group's signal. On a change, the browser re-fetches `/api/challenges/<address>/board` (debounced), which applies the visibility rules server-side. Member data never travels over the socket, and there is one access-control path.
- **Reconnects:** a pure state machine (`lib/board/live.ts`): live → reconnecting (backoff 1s, 2s, 4s … 30s) → live; offline pauses retries until the browser is online again. Any disconnect marks "missed changes", so the board is re-fetched as soon as it is live again; it is also re-fetched when the tab becomes visible. The header shows Live / Reconnecting / Offline.
- **Time moves on the client:** the server sends the board input; the browser rebuilds the board every second (`buildBoard`), so "today", the countdown and pending days advance without requests. The first render uses the server's time, so hydration matches.
- **Visibility:** the owner chooses who sees the member board (everyone who can see the challenge, or players only). Each member chooses whether their check details (counted/considered, providers) are shown. Day results are always shown: they decide payouts and are public on-chain.

**Added**
- Migration `group_board`: `board_visibility` (challenges), `share_checks` (memberships), `challenge_activity` with RLS, bump triggers, Realtime publication. CI bootstrap creates the `supabase_realtime` publication.
- `@codestreak/shared` `board.ts`: `buildBoard`, `cellState`, `memberState`, `countdownFor`, `formatCountdown`, phase labels.
- Group board on the challenge page: status, live indicator, countdown to the next milestone (joining closes / starts / day N ends / final checks / disputes), pool, players, still in, survived · out, done today; member grid with one cell per day (verified, missed, Shield, couldn't check, today, waiting, upcoming) with tooltips, member state badges, "You"/"Creator"; motion: rows re-order with a spring, changed cells pop, out members fade. Owner and member settings under the board.

**Tests:** board building (cells from results, Shields and time; out after an unshielded miss, still in with a Shield or an outage day; counts, sort order, done today; countdown per phase; formatting); connection state machine (live, offline → online → re-fetch, no retry storm while offline, backoff and reset). SQL: joins, results, Shields and both settings bump the version; the table is published to Realtime; an outsider can't see a private group's activity; users can't bump it or change board visibility directly; deleting a challenge cleans up through the cascading triggers.

### Phase 21 fix: creator joins their own private group

The relayer only co-signed private joins for invited people, so a group's creator (who has no invitation to their own group) got "Invitation needed". Creators may now join their own private groups. Join buttons after an error now name the wallet ("Try again with Phantom") instead of showing identical "Try again" buttons.

### Phase 21 fix: links inside CodeStreak open in the same tab

Notification links always opened a new tab (meant for Solana Explorer), so "Open group" after accepting an invitation opened the group in a new tab. CodeStreak pages now open in the same tab (and close the notification); only outside sites open a new tab, marked ↗.

---

## Phase 22: Sponsorship (M)

**Goal:** anyone can add to a challenge's reward pool without playing, with an on-chain receipt and a public sponsor leaderboard; private groups can be sponsored only through their private link.

**Design**
- **Amounts:** the program only requires more than zero, so the app owns the limits: 0.1–10,000 USDC or 0.001–100 SOL per sponsorship (typo and dust guard), at most 6/9 decimals. One shared rule (`parseSponsorAmount`) runs live in the modal and again on the server, which also checks the wallet balance.
- **Receipt:** the program's `SponsorReceipt` account (one per wallet per challenge) accumulates each sponsor's total on-chain. The app mirrors every sponsorship transaction (`sponsorships`, unique per transaction) and the leaderboard links the receipt account and the latest transaction on Explorer.
- **Private sponsor link:** one per group, like invite links: 256 random bits, shown once, only the SHA-256 stored; making a new link kills the old one; the creator can turn it off. The link page shows title, pool, players count and sponsors, never members. Private pools need the relayer's co-signature for `sponsor_pool`, given only to the creator, members, live invitees, or holders of the current link: without it the program rejects the transaction.
- **Same rails as joins:** relayer pays fees and the receipt's rent, idempotency key per attempt, rate limits, policy allowlist, simulation, SOL wrapped in the same transaction.

**Added**
- Migration `sponsorship`: `sponsor_link_hash` (+ time) on challenges, `receipt_address` on sponsorships, `sponsor_leaderboard` view (RLS of sponsorships), sponsorships bump the live group board.
- `@codestreak/shared`: `SPONSOR_LIMITS`, `parseSponsorAmount`, `cleanSponsorMessage`.
- Relayer `prepareSponsor` (kind `sponsor`), `syncSponsor` mirror (sponsorship + receipt). Transaction kit: `reset`.
- Sponsor modal (presets + custom amount, live validation, optional message, wallet, stepper); Sponsors card with leaderboard on the challenge page; creator's private sponsor link panel; `/sponsor/[token]` page.

**Tests:** amounts (zero, blank, negative, non-numeric, too many decimals, below minimum, above maximum incl. u64-sized input); message cleaning; transaction-kit reset. SQL: raw token instead of hash, link without time, zero/negative/over-u64 amounts and a double-counted transaction rejected; leaderboard sums per wallet with latest tx, message and receipt; sponsorships bump the live board; an outsider can't read a private group's sponsors or link hash; users can't record sponsorships directly.

### Wallet sign-in (between Phases 22 and 23)

**Goal:** sign in with a linked wallet (one signature, no email, no Supabase email limit); email sign-in stays as is.

**Flow:** "Sign in with Phantom" → the server issues a one-time Sign In With Solana message (domain, URI, devnet, nonce, 5-minute expiry) tied to this browser by an httpOnly cookie → the wallet signs it (no transaction, no fees) → the server checks the signature against the exact stored message, consumes the nonce, finds the account that verified this wallet in Phase 13, and creates that account's session on the server (`admin.generateLink` + `verifyOtp`; nothing is emailed, the token never leaves the server). Then the normal route guard (username step or `next`).

**Loopholes checked and closed**
- *Replay:* nonces are single-use (atomic conditional update) and expire in 5 minutes.
- *Message swapping:* the client never sends the message; the server verifies against the text it stored for that nonce.
- *Reusing a wallet-linking signature to sign in (or the reverse):* different first line and purpose; each check uses only its own stored message (tested).
- *Signature completed in another browser:* challenges are bound to the requesting browser's httpOnly, SameSite=Strict cookie (stored as SHA-256).
- *Signing in to someone else's account:* only a wallet its owner linked with a signed proof maps to an account, and a wallet belongs to at most one account (unique constraint). Unlinking removes wallet sign-in.
- *Creating accounts through the wallet:* impossible: wallet sign-in only logs into existing accounts (sign-up stays email-first).
- *Account enumeration:* a challenge is issued for any valid address; "not linked" is only revealed after a valid signature, i.e. to the wallet's owner.
- *Owner lock-out by spam:* limits are per browser (10 challenges, 5 failures per 15 min) and per network (30 challenges), never per wallet address, so nobody can lock out a wallet's owner. Brute force is impossible anyway (needs the private key).
- *Phishing:* the message names the site (Sign In With Solana layout) so the user and wallets can see who is asking; CodeStreak's own message says signing moves no funds.
- *Open redirect:* `next` is sanitized (`safeNext`).
- *Suspended accounts:* refused. Server actions keep Next.js origin checks (cross-site posts rejected).
- *Side effect (by design):* a wallet sign-in invalidates any sign-in email still unopened for that account.

**Tests:** shared login check (valid, replayed, expired, other browser, wrong wallet, altered message, linking signature reused for login); SQL: duplicate nonce, over-10-minute challenge, EVM address, raw cookie stored, users/guests can't read, forge or reset challenges.

---

## Phase 23: GitHub linking (S)

**Goal:** link a GitHub account through Supabase identity linking, store its numeric ID, show it in Settings, and make sure a GitHub account can't be shared or swapped to cheat.

**Flow:** Settings → **Link GitHub** → `linkIdentity({ provider: 'github' })` (GitHub OAuth, public profile only) → `/auth/callback` (PKCE) → Settings, where the server reads the identity from the **Supabase admin API** (never from the browser) and records the numeric ID in `linked_accounts`. Unlink: the server first (may refuse), then the Supabase identity.

**Loopholes studied and closed**
- *One GitHub on two accounts:* Supabase refuses linking an identity owned by another user, and `linked_accounts` is unique on (provider, provider user ID). Both layers tested.
- *Username reuse:* GitHub usernames can be renamed and re-registered by someone else, so the numeric ID (validated `^[1-9][0-9]{0,19}$`) is the key; the username is display-only and refreshed on each visit.
- *Swapping mid-challenge* (switching to a friend's busier account, or passing yours around): unlinking or changing the GitHub account is refused by a database trigger while the user is in an open (not settled/cancelled) challenge. Renames are still fine.
- *Account hopping:* every unlink is recorded; a released GitHub account can't be linked to a **different** CodeStreak account for 30 days (database trigger). The same person can re-link immediately.
- *Going around the app* (calling Supabase's `unlinkIdentity`/`linkIdentity` directly): CodeStreak's record is authoritative and only the server changes it; while locked, a removed or different Supabase identity is ignored. A failed admin lookup is never treated as "unlinked".
- *Forged records:* users can't insert/update/delete `linked_accounts` (RLS); releases are server-only.
- *Joining without the accounts the rules need:* the relayer refuses to prepare the join ("This challenge counts GitHub activity. Link GitHub first"). LeetCode requirements are waived until LeetCode linking exists.
- *Least privilege:* CodeStreak never stores GitHub tokens; verification will use public data by numeric ID.
- *Error pages:* GitHub/Supabase refusals (already linked elsewhere, cancelled, linking disabled) come back to Settings as a short whitelisted code, never echoing provider text.

**Note:** enabling the GitHub provider also lets people sign in with GitHub (Supabase can't enable linking without sign-in). That is safe: it only reaches accounts owning that GitHub identity, and the rules above still apply.

**Added:** migration `github_linking` (numeric ID check, `refreshed_at`, `linked_account_releases`, lock and cooldown trigger); `@codestreak/shared` `githubAccountFromIdentity`, `missingProviders`; `lib/accounts/github.ts` (sync, unlink, lock); `/dashboard/settings` with the GitHub card; dashboard "Accounts" links there; join requirement in the relayer; callback routes linking errors back to Settings.

**Tests:** identity parsing (numeric IDs, malformed and non-GitHub identities); provider requirements (all / any / none). SQL: username as ID, leading zero, same GitHub on a second account, two GitHubs on one account, direct user insert, unlink and swap during an open challenge (rename allowed), 30-day cooldown for another account (same account allowed; allowed after 30 days), profile deletion still cascades.

### Phase 23 fix: GitHub link returned to localhost

Linking succeeded (auth log: `identity_linked`), but Supabase sent the browser back to its Site URL (localhost) because the return address (with `?linked=github` in `next`) didn't match the allowed Redirect URLs. The return path is now plain `/dashboard/settings`. Set the Supabase **Site URL** to the Render URL so any fallback lands on the live site.

---

## Phase 24: GitHub provider (L)

**Goal:** turn a user's GitHub activity for one day into a day result (verified / failed / indeterminate), from real data, with anti-cheat filters and creator options.

**Pipeline** (`@codestreak/shared/verification`):
1. `GET /user/{id}`: numeric ID → current login (survives renames).
2. `GET /users/{login}/events/public`: PushEvents in the day window. **Since October 2025 push events carry no commit list**, only `before`/`head`, so:
3. `GET /repos/{repo}` (fork? owner?, cached) → `GET /repos/{repo}/compare/{before}...{head}` for the pushed commits (new branch or rewritten history: the newest commits on `head`).
4. `GET /repos/{repo}/commits/{sha}`: files and patches, **only** for commits that can count (merges and other authors are skipped without the call). At most 80 detail calls a day.
5. Filters → meaningful-line count → duplicate hashes → day result.

**Rules** (all from push time on GitHub's clock; dates and files are user-controlled, so every rule is a filter, never a source of credit):
- Never counted: merge commits, commits by others, repos the user doesn't own, the same commit twice, the same change under a new SHA (rebase, cherry-pick, copy to another repo), **whitespace-only/re-indented changes and moved lines** (an added line matching a removed line in the same file), blank, brace-only and comment-only lines.
- Not counted unless the creator allows, each with a limit: **README/docs** (≤ 50% of the daily goal), **lockfiles, build output, minified and generated files** (≤ 25%), **own commits in own forks**, **backdated commits** (made up to N ≤ 72 hours before the day starts).
- Whitespace-only changes and re-pushed duplicates have no option on purpose: counting them would let anyone farm lines.
- **File filter:** extensions (`.ts`, `py`) and/or exact names (`main.py`, `Makefile`); empty = all source files (30 common languages).
- **Day result:** verified at the goal; below it, **failed only if GitHub was read completely**. Rate limits, errors, too many commits or diffs GitHub omitted make it **indeterminate** (never forfeits a stake).

**Real data (CodeStreak repo, 22 Nov):** 20 commits read with 14 API calls; 12 authored by the assistant's git identity (author mismatch) and 8 PR merges (merge commits) → 0 lines → failed, which is correct: none were the user's own commits. A real one-line test edit counted exactly 1 meaningful line.

**Creator options:** wizard step "Rules" → "GitHub options (strict by default)"; stored in the hashed rules document (`fileFilter`, `allow`); the challenge page lists them. Older challenges stay strict.

**Check any account and day:** `pnpm verify:github -- --login <github-login> --date YYYY-MM-DD [--min 15] [--files ".ts main.py"] [--allow docs,generated,forks] [--backdate 4]`.

**Tests:** fixtures for whitespace-only, moved lines, lockfiles, README, minified (by name and by long lines), forks, backdated, rebase duplicate; each option on with its cap (docs alone can never complete a day); options that stay excluded with everything on; file filter by extension and name; rules document → engine rules (strict defaults, caps enforced); day outcome; pipeline with a fake GitHub (normal push, merges and other authors skipped without detail calls, new branch, rewritten history, rate limit, network error, commit cap, deleted account); wizard file-type parsing.

### Phase 24 follow-up: clearer `verify:github` output

The command now says why nothing counted: no public push events yet (GitHub's public feed can lag; private repos are never visible), commits authored by another identity (git email not on the account), backdated commits, or how many more lines are needed. The collector reports `pushes` (push events GitHub listed in the window).

Real case: a push to `Chirag126/trust-dependency-mapper` at 12:37 UTC (branch `fix/render-proxy-trust`, 3 added lines = 2 meaningful) was not yet in GitHub's public feed minutes later, so 0 commits were read.

### Phase 24 follow-up: repository activity, selected repos, consent before staking

**Problem found with real data:** a push to `Chirag126/trust-dependency-mapper` at 12:37 UTC was still missing from GitHub's public event feed long afterwards, so the verifier saw nothing. GitHub's **repository activity API** listed both pushes immediately, with server time, branch, before/after and the pusher.

**Verifier now:** account → repositories (creator-selected ones by numeric id, otherwise the user's public owned repos pushed since the day started, ≤ 20) → `/repos/{repo}/activity?actor=` (push, force push, branch creation; merge-button merges are not read: that work counts when pushed) → compare → commit details. Real data, 23 Nov: 2 pushes found, 7 API calls; `c6f65870` counted 2 meaningful lines, `0ecb47e2` had no countable changes → failed at 2/15 (correct).

**New anti-cheat rule:** the **pusher must be the user**. Git lets anyone put someone else's email on a commit; in a shared repo that would credit the victim. Commits pushed by another account are skipped (`pushed-by-other`).

**Creator option: "Only pushes to these repositories"** (up to 5, `owner/name` or GitHub URLs). The server resolves each on GitHub when the challenge is created, refuses missing or private ones with a specific message, and stores `{ id, fullName }` in the hashed rules: renames, transfers or a new repo under the old name can't change what counts. Members' own pushes there count whoever owns the repo; other repos don't (`other-repo`). A selected repo that later becomes private or disappears makes days indeterminate (never failed).

**Before you stake:** the join area lists stake, schedule (UTC), the exact rules (with the creator's GitHub options), what missing a day costs, payouts, Shields, the minimum-players refund, outage handling, when results are final, the GitHub lock and private-group visibility. Joining needs "I understand". The browser sends the on-chain rules fingerprint the user accepted; the server refuses if it isn't the on-chain one (`rules.changed`) or if the saved rules don't hash to it (`rules.unverified`: e.g. challenges created outside the app). The rules card shows "Matches on-chain fingerprint" or "Can't be verified". Invite links show stake, length, start, join-by and the daily goal before accepting.

**Clearer messages:** `verify:github` lists each repository read and explains from what it saw (no public repo pushed that day; pushed by others; author email not on the account; merges; re-indents; lines still needed; incomplete data). The join requirement says exactly which account to link.

**Tests:** collector with a fake GitHub (unlisted-in-feed pushes found, pr_merge not read, spoofed author pushed by another account, selected repos by id, private/deleted selected repo → indeterminate, branch creation and force push, rate limit, network error, commit cap, no pushes, deleted account); repo list parsing.

### Phase 24 follow-up: day checks in the app

**Why:** the only way to see a verification was `pnpm verify:github` in a terminal. Players, creators and sponsors need it in the app.

**Your day (players of GitHub challenges):** a card on the challenge page with **Check now** (once a minute per player, protecting the GitHub budget). It reads the player's pushes on GitHub for the running day (or the last day during final checks) and shows progress (lines of the goal), a status (goal reached / not yet / couldn't be fully checked), plain explanations, and every commit with a link to GitHub, its lines and why it did or didn't count. Labelled as a preview: the final result is recorded after the day ends.

**Group board:** each member shows "x/goal lines today" and **View checks** opens their log. Every check updates open boards live.

**Storage:** `member_day_checks` (latest summary per member, day, provider) and `evidence` (one row per commit, with the reason in words); each check is a `verification_runs` row (`manual`). A re-check replaces that day's evidence (force pushes can remove commits); commits considered on earlier days never count again.

**Privacy fixed in the database:** "Show my check details" (Phase 21) and the creator's "players only" were only applied by the app; anyone who could see a challenge could read every member's evidence through the API. `private.can_view_member_checks` now enforces both on `evidence` and `member_day_checks`: hidden details are visible only to their owner (not even the creator); "players only" hides checks from non-players.

**Explanations are shared** (`explainGithubDay`, `SKIP_REASON_TEXT`) by the app and the command, so they always agree. Fixed: commits written by another GitHub account were described as "your git email isn't on your account"; now `author-mismatch` (another account) and `author-unlinked` (email on no account) are separate, with correct grammar.

**Tests:** explanations for the real 23 Nov day (14 other-account commits, 9 merges, 1 no-code commit, 13 lines needed), no-push cases, goal reached, incomplete data, a sentence for every reason; author-unlinked vs author-mismatch; checkable day (not started, running, final checks, over, cancelled). SQL: outcome/goal/hints constraints; outsider sees only shared checks; a member sees their own hidden details; even the creator can't see hidden details; players-only hides checks from outsiders but not from players or the creator; users can't write checks; checks bump the live board.

---

## Phase 25: LeetCode binding (S)

**Goal:** link a real LeetCode profile to a CodeStreak account, safely.

**Why it differs from GitHub:** LeetCode has no OAuth and no public numeric user id, so ownership is proved by **a one-time code placed in the profile summary**, which only the owner can edit; CodeStreak reads the public profile **live** through Firecrawl (`maxAge: 0`, never a cached page) and checks it deterministically (no AI extraction).

**Flow (Settings → LeetCode):** enter a username (plain, `@name` or a pasted `leetcode.com/u/name` link; leetcode.cn and other sites refused) → **Get a code** (`CS-LC-XXXXXXXXXX`) → paste it into LeetCode Edit Profile → Summary → **Verify**. Linked: profile link, date, lock badge, Unlink.

**Loopholes closed**
- *Reusing a code:* random, bound to this account and this handle, expires in 15 minutes, consumed atomically on success; one live code per person (asking again cancels the old one). A code left on a profile is useless later.
- *Wrong code:* only the exact code, as a standalone token, counts (an old/other code, or the code inside a longer word/link, fails).
- *Wrong page:* the scraped page must load (HTTP 200) and be that user's profile: LeetCode titles it "<handle> - LeetCode Profile" (checked live on a real profile; the handle also appears inside sign-in links, which don't count). Missing profiles, error pages and other pages fail, each with its own message.
- *Duplicate handle:* handles are stored lower-cased and unique: `Alice` and `alice` can't be linked to two accounts (database), refused early with a clear message. One LeetCode per CodeStreak account.
- *Handle from the browser:* the server verifies the handle stored with the code, never one sent at verify time.
- *Credit burning:* 5 codes per hour, 5 verify attempts per code (counted before scraping, with an optimistic lock so parallel clicks can't exceed it).
- *Shared rules:* locked during open challenges, 30-day cooldown before a released handle moves to another account (database triggers from Phase 23); joining requires LeetCode when the rules count it (only LeetCode: linked LeetCode; GitHub or LeetCode: either).

**Residual risk (documented):** LeetCode usernames are the only public identity; if LeetCode ever let a user rename and someone else took the old name, the stored handle would point to the new owner. The per-challenge lock limits this to between challenges.

**Tests:** handle parsing (names, @names, profile links; other sites, paths, bad characters refused); binding check (exact code, old/other code, code inside a word, someone else's page, missing profile, unreadable page, the real lee215 page shape); Firecrawl client (live fetch, Firecrawl error, network error). SQL: one live code per person, ≤ 15-minute codes, malformed code, bad handle, attempt cap, used code frees the slot, capitalised handle, same handle on a second account, users can't read codes.

### Phase 25 follow-up: LeetCode's new settings page

LeetCode separated account and profile settings (May 2026); the old "Edit Profile → Summary" wording no longer matches its UI. The verifier already searches the whole public profile page, so the instructions now say: put the code in any field shown on the public profile (the bio under the name, or ReadMe), check it on `leetcode.com/u/<handle>/`, then Verify. The settings link points to `leetcode.com/settings/profile/`.

## Phase 26: LeetCode provider (M)

LeetCode has no public API for "what did this person solve today", and its profile page shows only the
solved count, per-difficulty counts and the last ~15-20 accepted submissions (title, submission id,
"x minutes ago"). So the provider works from **snapshots** of that public page, read live through
Firecrawl (`maxAge: 0`), and compares them.

**Snapshots** (`leetcode_snapshots`, server-only, RLS on with no policies):
- at join (after the response), every 30 minutes by the worker (`pg_cron` `codestreak-leetcode-snapshots`,
  `:15/:45` → `/jobs/leetcode-snapshots`, only for players in a running LeetCode challenge whose newest
  snapshot is older than 25 min, max 15 profiles a run), and on every "Check now".
- one snapshot serves all of a person's challenges; a page that isn't `<handle> - LeetCode Profile` or
  fails to load is stored as **unreadable**, never as zero.

**The day rule** (`evaluateLeetcodeDay`, `@codestreak/shared/verification`):
- **Anchor** = the newest readable snapshot of the same handle taken at or before the day starts (the
  "midnight" snapshot). No anchor → indeterminate (never a fail).
- A solve is **new** when its submission id is above every id in the anchor and its title is not in the
  anchor's recent list. **Credit = min(rise in solved count, distinct new titles)**: both signals must agree,
  so re-solving an old problem (new submission, count unchanged) earns nothing.
- Difficulty: only the Easy/Medium/Hard count rises can prove a solve's level, so a Medium+/Hard goal
  counts only those rises.
- **Withdrawn evidence**: a submission seen in an earlier snapshot today that is gone later, or a solved
  count that goes down, zeroes the day's credit and is shown in the log.
- Outcomes: profile unreadable / no anchor / no data → **indeterminate**; submission history hidden
  (private) → **failed**; otherwise met / not met.

**Creator options** (wizard → Rules, stored in the rules document and so in the on-chain fingerprint):
providers GitHub, LeetCode or both (any/all), new problems a day 1-5, minimum difficulty any / Medium+ / Hard.
The challenge page and the stake consent list the LeetCode rules in plain words.

**Loopholes closed:** re-solves, solves before the day (age older than the day), deleting or hiding
submissions after a check, switching the profile to another handle (snapshots are per handle, and links
are locked during a challenge), hiding the profile (fails, it doesn't excuse), Firecrawl/LeetCode outages
(indeterminate, never a fail), check spamming (60 s cooldown per member, worker cap per run).

**Fixtures** (`leetcode-day.test.ts`): real solve the same day → met; scrape failure → INDETERMINATE;
private profile → FAILED; old-problem re-solve → no credit; withdrawn evidence; credit = min(count, titles);
difficulty; solve before the day; no anchor; old rules documents; snapshot round-trip.

**Test it:** create a challenge with LeetCode (1 new problem), join with a linked LeetCode account, solve a
problem you have never solved on leetcode.com, then press **Check now** on the challenge page.

## Phase 27: Rules engine and receipts (M)

`packages/shared/src/rules-engine.ts` (isomorphic) + `verification/day-evaluation.ts` (provider adapters).

**Flow:** each provider reports an outcome (`met`, `not_met`, `failed` = a rule broken, `unknown` = not
readable), progress, evidence and data **quality** → a **confidence score** → the challenge's **ANY/ALL**
rule combines them → the confidence gate → a **receipt** whose SHA-256 is the evidence hash.

**Confidence (0-100, integers only):** `(complete ? 100 : 60) × coverage% − min(30, 10 × gaps)`; unreadable = 0.
- GitHub: incomplete read → 60; each file GitHub returned without a patch is a gap.
- LeetCode, by what the outcome depends on: *met* → anchor age (≤1 h 100, ≤6 h 90, older 75) and
  unreadable snapshots in the day; *not met* → whether a snapshot reaches the end of the day (100, last
  30 min 85, earlier 50); *hidden history* → 100 only when two hidden snapshots 25+ min apart confirm it
  (one alone could be a glitch: 70); a page with no solved count is a layout problem → unknown.

**ANY / ALL**
- ANY: verified if one provider met its goal (most confident decides); failed only if every provider was
  read and none met it; otherwise indeterminate.
- ALL: verified only if all met (least confident decides); failed as soon as one is definitely short.
- **Gate:** failed needs confidence ≥ 80, verified ≥ 50; below that the day is indeterminate (never costs
  a stake). Shaky data can't fail an honest player or pass a cheat.

**Receipt** (`buildReceipt` → `sealReceipt`): canonical JSON (keys sorted, NFC text, evidence de-duplicated
and sorted, integers only, max 200 evidence items with the rest counted) of: version, engine id, challenge,
wallet, day, window, rules fingerprint, rule, verdict, confidence, reason, and per provider outcome, value,
goal, confidence, quality and evidence (ids + reason codes, never display text or check times). Same facts
in any order → same bytes → same hash; `verifyReceipt` re-checks a stored one.

**Database** (`day_receipts`): the receipt text must hash to its `evidence_hash`, name the same day and
engine, and (checked at commit) match its `day_results` row: same hash, same verdict, same wallet and
challenge. Changing a result without a new receipt is rejected. Receipts list commit SHAs and submission
ids, so they follow the member's "share check details"; `day_results` keeps only the hash.
`member_day_checks.confidence` stores each preview check's confidence.

**Phase 26 gap fixed:** a LeetCode solve in a day's last ~30 minutes was missed (snapshots after the end
were ignored). The final check now also uses snapshots up to 45 min after the end, and excludes solves
dated after the end (`after-the-day`, counted for the next day; the minute estimate leans to the player).

**In the app:** "Check now" stores the engine outcome + confidence per provider, and the day card shows
*"If the day ended at this check: Verified / Failed / Can't be decided · confidence N%"* with the reason.

**Tests:** ANY/ALL matrix; score boundaries 49/50 (verify) and 79/80 (fail), directly and through quality;
same input in any order → same hash; a golden hash cross-checked with an independent implementation
(Python) and with Postgres `sha256`; every field change changes the hash; NFC; duplicates; malformed input
with specific errors; LeetCode/GitHub through the engine (last-minute solve, after-the-day, confirmed vs
single hidden snapshot, layout change, stale anchor); SQL tests for every receipt guard.

**Next (Phase 28):** the worker builds the receipt after each day, writes `day_results` + `day_receipts`
in one transaction and records the hash on-chain with `record_verification`.

### Fix: sign-in links used up by link previews

Testing found both sign-in links "expired" on first open. Supabase's session log showed both were
spent seconds after sending by `WhatsApp/2.23.20.0`: the link was shared in WhatsApp, whose preview
bot fetched it first (Slack, Teams, Telegram and Outlook Safe Links do the same).
- `/auth/confirm` now accepts `?token_hash=&type=` and spends it only when the person presses
  **Continue** (bots fetch pages, never press buttons); `/auth/callback` no longer spends a token on GET.
- Templates in `supabase/templates/` link to that page. Supabase only allows custom templates with
  custom SMTP on the free plan, so they take effect once SMTP is configured (see render.md).
- Until then the expired-link message names the cause: open the link straight from the email.

### Video 1 review fixes (sign-in, accounts, dashboard)

Found by watching the first test recording frame by frame and confirming each cause in logs or code:
- **GitHub link returned to `localhost:10000`** (1:12): behind Render's proxy a route handler's own URL is the
  internal address, so `/auth/callback` and the proxy redirected there. Redirects now use `APP_URL`
  (`lib/app-origin.ts`).
- **"Something went wrong" on Email me a link**: Supabase's log showed the SMTP server rejecting the login
  (`535 Invalid username`). Email-service failures now get their own message and a server log line.
- **Header showed the wrong button** after signing in or out (0:24, 0:34-0:48): it read the session once;
  it now re-reads it on every navigation.
- **Wallet sign-in**: only the chosen wallet's button spins, both stay disabled until the next page loads,
  and the email form's old error is cleared.
- **GitHub unlink**: the card switches to "Not linked" when the server confirms, not seconds later.
- Settings: GitHub, LeetCode, then Wallet; unlink buttons look like buttons; LeetCode "summary" copy → ReadMe;
  dashboard no longer says "(and later LeetCode)".
- **Cancelled challenges**: no "Surviving 100%", no reward estimate, players shown as "Refunded", red badge,
  and the page says why it was cancelled.

### Video 2 review fixes (challenges, joining, invites, sponsorship)

Found by watching the three recordings of video 2 frame by frame:
- **Page out of sync with the live board** (biggest one): only the Group board updated live; the header
  (players, pool, phase "joining" while running), Sponsors list and reward estimate stayed as loaded.
  The board now refreshes the rest of the page when players, pool, sponsors or phase change (≤ 1 per 3 s).
- **Two spinners**: Create, Join and Sponsor spun on every wallet button; now only the one you picked.
- **Join requirements up front**: "link GitHub/LeetCode first" is shown before pressing Join, with a link
  to Settings, instead of after a failed attempt.
- **Wizard**: a field's error clears when you edit it; Shield grace follows demo day length.
- **Surviving 100% before the start** → "–" until the challenge runs (cards and page).
- **Invite page** said "an accepted LeetCode solution … and/or": it now uses the same sentence as the
  challenge page ("… or a new LeetCode problem solved"), from one shared function.
- **Invites**: a revoked link no longer stays on screen to copy; the public-ID box no longer has a
  real-looking ID as placeholder; link expiry shows in UTC and explains when it's capped at the deadline.
- **Dashboard**: lists your challenges (created or playing); refreshes when you come back to the tab,
  so new invitations appear.
- Sponsor dialog: wallet buttons no longer jump between side-by-side and stacked.

### Video 3 review fixes (live challenge, checks, after the days)

Found by watching the three recordings of video 3 and checking the stored snapshots, evidence and chain mirror:
- **A real LeetCode solve got no credit**: the 21:43 snapshot read solved = 1 with an empty "Recent AC"
  list (LeetCode fills it after the counts), so credit = min(1, 0) = 0; later reads at 21:51 and 21:54
  were empty again. A page with solved > 0 and no recent submissions is now **unreadable** (never
  "nothing solved", never "withdrawn evidence"), and is read once more with a longer wait.
- **A day's evidence could vanish**: evidence is unique per member + item across days and was inserted
  as one batch, so one item already recorded on another day rejected the whole batch (day 2's README
  commit). Items already recorded are now skipped instead.
- **"Your day 1" on day 2**: the card now remounts per day and the page refreshes when the day changes.
- **Raw phase names** ("active", "disputeWindow", "awaitingSettlement") → Running / Dispute window / Ready to settle.
- **Done today 0/2** while both goals were met: it now also counts goals met at the latest check (ANY/ALL).
- Mid-day verdict says **"So far today: Not done yet"** instead of "Failed".
- After the days end, the board says plainly that results aren't recorded yet and stakes stay in escrow.
- **Dashboard "Your challenges"**: aligned rows (title + buy-in/length/date, one status column, role),
  Active and Past groups, past list collapsible. Status is honest about money: "Results pending" for
  ended-but-unsettled, "Too few players" for under-filled, "Settled" only when settled.
- Copy: cancelled challenges no longer claim stakes "were refunded" (none were claimed yet); they are claimable.

**Known gap (closed in Phase 28):** nothing after the days ran yet: day results, on-chain verification
records, finalize, settle and claim/refund. Stakes stayed safe in escrow.

## Phase 28: Verification job (M)

Everything after a day ends now happens by itself: `apps/worker/src/verify/*`, job `verify`, migration
`verification_job`.

**Schedule (by challenge day boundaries).** pg_cron `codestreak-verify` runs every minute but wakes the
worker only when `public.verification_has_work()`: a finished day without an on-chain result, a pool to
cancel or settle, or payouts to send. A day is recorded a quarter-day after it ends (1 to 45 minutes:
late pushes, LeetCode's list catching up), never later than 2 minutes before the verification window
closes (`private.record_delay_secs`, mirrored in `schedule.ts`). All timing uses the chain's clock.

**Per challenge, under a lease** (`begin_verification_run`: one scheduled run per challenge; a stuck
lease expires after 10 minutes):
1. **Cancel** an underfilled pool once joining closes (`cancel_pool`, allowed for anyone).
2. **Record** each due day for each player: the same Phase 24/26/27 evaluation as "Check now" (a final
   LeetCode snapshot is taken after the day if none exists) → receipt → `save_day_result` (result,
   receipt, final evidence and audit entry in one transaction) → `record_verification` signed by the
   verifier → `mark_day_recorded`. A wallet that joined without a CodeStreak account is recorded as
   "could not verify" (never a fail).
3. **Settle** after the dispute window: `finalize_participant` for each player, then `settle_challenge`.
   Unrecorded days make a player *voided* (stake back); nobody surviving refunds everyone.
4. **Pay out** (claims are permissionless): reward / refund / sponsor refund straight to each owner's
   token account; the verifier pays fees and creates a missing token account. **SOL arrives as Wrapped
   SOL** (the program pays tokens), which the wallet can unwrap.
Every step is mirrored (`mirror_pool_state`, `record_payout`: receipts, membership status/payout,
`challenges.payouts_done_at`) and written to `audit_log`; each run is a `verification_runs` row.

**Idempotency.** The chain is the source of truth. Every attempt to send, including each retry, first
re-reads the account it would change and sends nothing if the change is already there: a duplicate or
overlapping run, or a retry after a lost confirmation, never sends a second transaction. A saved day
result is never recomputed: later runs reuse its receipt hash, so the chain always gets the hash the
receipt was sealed with.

**Retries and caching.** RPC and Supabase calls retry transient failures (429, 5xx, timeouts, blockhash)
with backoff (`packages/shared/src/retry.ts`); program errors are final and reported with the program's
error name. A provider that can't be reached defers that player-day to the next run, until 3 minutes
before the window closes (then it is recorded as "could not verify"). GitHub data is fetched once per
account and day per run.

**UI.** After a challenge settles or is cancelled the page shows your result and payout ("Your reward of
… was sent to your wallet"); the board's after-the-days note explains that results and payouts are automatic.

**Setup (render.md):** worker `VERIFIER_KEYPAIR_JSON` + `VERIFIER_PUBKEY`, and devnet SOL for the verifier.

**Tests:** SQL (`99d_verification_job_test.sql`: work selection, delay, lease, cached results, idempotent
mirrors, permissions) and worker (`run.test.ts` with an in-memory program: a demo challenge's days get
recorded; a duplicate run sends no transaction and re-evaluates nothing; an RPC failure is retried and
sent once; a lost confirmation is not re-sent; program errors are final; settle with rewards and dust;
full refund; cancel with sponsor refunds; wrong verifier; `db.test.ts`: Supabase 5xx retried, 4xx not).

### Phase 28 follow-up: payouts made before the job existed

First live run (all on devnet, public RPC; its 429s were retried and every run succeeded):
- **Video3 Group** and **Fresh demo grp** settled. No day had been recorded, so all players were voided and
  refunded 0.01 SOL each; Video3 Group's 0.005 SOL sponsorship was refunded too.
- **fresh demo group** (1 of 2 players) was cancelled and refunded.
- 4 older cancelled challenges (GQcq, EC7E, Ge21, nnn) had already been refunded on-chain by
  `devnet:close-challenges`, so the job correctly sent nothing, but the app never showed those refunds.
  The job now mirrors a payout it finds already made (membership marked paid; no receipt, since the
  transaction is unknown).

## Phase 29: Crank and reconcile (M)

**Crank (finalize, settle, cancel).** The Phase 28 `verify` job is the crank. Every minute pg_cron
checks for work: a pool under its minimum once joining has closed, a finished day, the end of the dispute
window, or payouts still owed. The worker then cancels, records, finalizes each player, settles and pays
out, re-reading the chain before every transaction. No step needs a person. After each challenge it
handles, the job now also reconciles that challenge, so the mirror is right as soon as the crank changes
anything.

**Reconcile (chain → database).** New job `reconcile`, run by pg_cron `codestreak-reconcile` at :05 and :35
(`apps/worker/src/reconcile/run.ts`, migration `reconcile`). It reads every challenge of the program,
its participants and their day bitmasks; it only reads the chain and sends no transactions.
`public.reconcile_challenge()` then fixes drift in one transaction:
- **Challenges** created outside the app (scripts, demo seed) are added, attributed to the creator's
  profile when their wallet is linked. Pool state, player count and totals follow the chain.
- **Payouts** marked done while the chain still owes someone (a player or a sponsor) are reopened, so the
  crank pays them.
- **Members** who joined outside the app with a verified linked wallet are added. Status, deposit,
  participant address, and finalized and claimed times follow the chain.
- **Days**: the "on-chain" flag follows the chain. A result the chain doesn't have is cleared, so the
  crank records it again; one the chain has is set. A different result on-chain is reported, never
  overwritten, because the receipt is the evidence for the database's result.
- Every fix goes to `audit_log` (`reconcile.*`) with the database value and the chain value. Warnings are
  logged, not written to the audit log: a membership with no on-chain player, a database challenge
  missing from devnet, or a result mismatch.
- A second pass over the same chain state changes nothing and logs nothing. Memberships are never
  deleted.
- **Robustness:** listing every account decodes them all; if one can't be decoded, the job checks the
  database's challenges one by one instead. Reads retry transient RPC errors.

**Why it matters for the crank:** the work queue reads the database (player count, pool state, day
flags). Drift there could hide work, such as an under-minimum pool never being cancelled, or create
phantom work. Reconciling closes that gap within 30 minutes, or immediately for challenges the crank
touches.

**Shared:** `challengeMirrorRow()` (`packages/shared/src/program/mirror.ts`) is the one definition of the
database copy of a Challenge account, used by both the web sync and the worker.

**Tests:** SQL (`99e_reconcile_test.sql`):
- drifted counts, totals and pool state are fixed and logged with both values;
- payouts are reopened while something is still owed;
- an outside join with a linked wallet is added, an unlinked one isn't;
- day flags are set and cleared;
- a result mismatch is reported and not overwritten;
- an outside challenge is added and attributed;
- the second pass is a no-op;
- users can't call it.

Worker (`reconcile/run.test.ts`): day maps, the payouts-pending rule, missing-on-chain warnings, retry,
and the fallback listing. The verify job's tests check that every run reconciles.

## Phase 30: Claim center (M)

Payouts are still pushed automatically by the worker (Phase 28). The claim center is where a player sees
them, and the fallback when the worker hasn't paid yet. **Dashboard → Payouts** (`/dashboard/claims`) and
a payout card on each settled or cancelled challenge page.

**What it shows** (read from devnet, not the database):
- **Animated totals**: received, ready to claim, and wrapped SOL waiting to be unwrapped.
- **One card per challenge you played or sponsored**: outcome, amount, state (paid with an Explorer link,
  ready to claim, not settled yet with when it settles, finalizing, nothing to claim) and a
  **line-by-line breakdown**. For a survivor: stake back plus a share of the pool, split into missed
  stakes, sponsorships and Shields per survivor. For a voided player: stake back; Shields stay in the
  pool. For a cancellation or full refund: stake and Shields back. For a failed player: where the stake
  went. For a sponsor: refunded, or paid to the survivors.

**Claim now** (survivors, voided players, refunds, sponsor refunds): the server sends the claim itself.
Claims need no signature from you, and the relayer pays the fee (and creates your token account if
missing). It is paid only to your own token account.

**Unwrap SOL**: SOL payouts arrive as Wrapped SOL. Unwrap closes your own wSOL account into plain SOL in
the same wallet, including its small rent deposit. You approve in your wallet; the relayer pays the fee.

**Loopholes closed**
- **Claim before settlement:** refused by the server with the settle time (and by the program). The
  card shows "Not settled yet" with no button. Finalizing players are refused too.
- **Double claim:** one fixed request key per player or sponsor and challenge is the lock. A claim
  already on its way is refused; a stuck one is retaken after 2 minutes. The program's `claimed` flag is
  final. If the worker paid a moment earlier, the user sees "Already paid", not an error, and the payout
  is mirrored.
- **Claiming for someone else, or to another account:** only your own membership or sponsorship, paid
  only to the owner's own token account, which the server builds.
- **Unwrap abuse:** only from one of your own verified wallets. A dedicated relayer policy
  (`checkUnwrapTransaction`) allows exactly compute budget plus one CloseAccount of your own wSOL
  account, to you, signed by you. No transfers, no other accounts, no other signers, no other fee
  payer. It is checked at prepare and again at submit.
- **Relayer drain:** the per-user rate limit and the relayer's minimum balance apply to claims and unwraps.
- **Amounts** come from one shared function, `claimable()` in `packages/shared/src/payout.ts`, which
  mirrors `rules.rs`. The worker uses it too.

**Tests:**
- shared: `claimable`, `claimBlock` and `payoutBreakdown` against the program's own settlement
  fixtures (survivor 25 and the last one 26, voided, cancelled, full refund, failed, blocked states);
- the unwrap policy (accepts your own close; rejects another destination, another account, extra
  instructions, a second close, another fee payer);
- SQL `99f_claim_center_test.sql`: only unwrap requests may have no challenge.

## Phase 31: Disputes (M)

**Player: dispute form (challenge page) and tickets (Dashboard → Disputes).** Once a day is recorded
on-chain as *failed* or *could not verify*, the player can open a dispute until the dispute window closes.
A dispute has a reason (20–2000 characters) and up to 5 https evidence links. Each ticket shows its
status and its full timeline: opened, approved or rejected (with the admin's note), then upgraded
on-chain (with the Explorer link), expired, or could not be applied.

**Admin review (`/admin/disputes`).** Admins are the profiles listed in `public.admins`. The page shows
waiting tickets with:
- the player (username and wallet);
- what the rules engine recorded (each provider's outcome, progress and confidence, from the day's
  sealed receipt);
- the reason and evidence links;
- when the window closes.

**Approve** or **Reject** needs a note to the player. Everyone who isn't an admin gets a plain 404: the
page doesn't reveal that it exists.

**Verifier upgrade.** An approval queues work for the crank: `verification_work` reason `dispute`, handled
before anything settles. The worker signs `record_verification(day, verified)` with the verifier key;
the program allows failed/indeterminate → verified until the dispute window ends. The evidence hash is a
**dispute receipt** (engine `codestreak-dispute/1`), which records:
- the ticket;
- the previous receipt's hash;
- the review.

`resolve_dispute` then replaces the day's receipt, marks the day verified (`source = dispute`) and
resolves the ticket, all in one transaction, still checked by the Phase 27 receipt constraints. Every
attempt re-reads the chain, so a retry never upgrades twice. An approval that misses the window is
closed as *expired*.

**Rules enforced by the database** (`open_dispute`, `review_dispute`, RLS), not only by the UI:
- only your own days, recorded on-chain, not already verified, while the challenge is open and before
  the dispute window closes ("The dispute window closed on … UTC");
- one live ticket per day and at most two per day;
- only admins can review, and a ticket can't be reviewed twice;
- approving after the window closes becomes *expired*;
- tickets and timelines are visible only to their owner and to admins (other members, outsiders and anon
  see nothing);
- only the worker (service role) resolves or closes tickets.

**Audit trail:** `dispute_events` (the timeline people see) and `audit_log` (`dispute.opened|approved|
rejected|resolved|expired|failed`, actor kind user/admin/worker).

Phase 11's unused `disputes` placeholder was replaced: it was empty everywhere, and members could see each
other's tickets.

**Tests:**
- SQL `99g_disputes_test.sql`:
  - opening;
  - every refusal (after the window, someone else's day, a verified or unrecorded day, a duplicate, a
    short reason, a bad link);
  - a player can't review or see other tickets;
  - an admin sees all and approves or rejects;
  - reviewing twice is refused;
  - the work order (dispute first);
  - resolution replaces the receipt and verifies the day;
  - a user can't resolve;
  - anon sees nothing.
- Worker:
  - an approved dispute upgrades failed → verified on-chain with a dispute receipt, once;
  - an approval after the window expires.

## Phase 32: Shield UI (S)

**Shields card** (challenge page, for players while the challenge runs). It is read from the chain and
shows:
- Shields left (`used of max`), the price, and the grace period;
- the days that can be protected right now: today, plus any finished day still inside its grace;
- for each such day, a live countdown that follows the chain's clock: "Shield closes in" today, or
  "Grace ends in" for a finished day. It turns amber in the last 2 minutes.

For a day in its grace, the card says whether it was recorded as missed or isn't recorded yet. **Shield
day N** runs the usual transaction steps: prepare (server), approve (wallet), confirm. The relayer pays
the fee. A SOL Shield is wrapped in the same transaction.

**Activation transaction.** `prepareShield` re-checks eligibility on-chain with `shieldBlock()`
(`packages/shared/src/shield.ts`), which mirrors `rules.rs check_shield` check by check. It then builds
`activate_shield(day)`; the relayer policy allows only that instruction, plus the SOL wrap. On confirm,
`syncShield` mirrors it: a `shields` row (the board shows the day as covered), a `shield` receipt, and the
pool totals.

**Shield covers a missed demo day.** The worker still records the day as failed, and finalize counts it
as kept: any uncovered failure → failed; every day verified or shielded → survived. The worker test
plays it end to end: both players miss day 3, only the shielded one survives and is paid the other's
stake.

**Handled:**
- **Expired grace:** the countdown reaches zero and the button is replaced by "Too late to protect this
  day: the Shield grace period is over". The server refuses with the same message using the chain's
  clock, and so does the program (`ShieldWindowClosed`).
- **Over the limit:** the badge shows 0 left, and each day shows "You have used all your Shields for
  this challenge". The server and the program refuse.
- **Also refused, each with its reason:** a day not started yet, a day already protected or verified,
  a final result, a closed challenge, Shields turned off, a wallet that isn't the player's own linked
  wallet.
- **No double buy:** one request key per attempt, and the program's own already-shielded check.
- **Drift:** reconcile adds Shields that are on-chain but missing in the database
  (`reconcile_shields`; the transaction is unknown then, so `shields.tx_signature` became optional).

**Tests:**
- shared `shield.test.ts`: the program's own fixture for the window edges (1 099 / 1 100 / 1 229 /
  1 230), invalid day, limit, already shielded or verified, finalized, closed, disabled, which days are
  listed, countdown format;
- relayer: `activate_shield` encodes the day as u16 and passes only for its own kind;
- worker: a Shield rescues a missed day at settlement; reconcile adds missing Shields;
- SQL `99h_shield_reconcile_test.sql`.

## Phase 33: Smart alerts & verification intelligence (M)

**Replaces the planned ElevenLabs voice coach.** The unused `voice_clips` placeholder (no rows, no
storage) and the `ELEVENLABS_*` variables are removed. No voice, no Polar, no paid service: everything
runs on Supabase (Postgres triggers, pg_cron, Realtime) and the existing app.

**Notification engine (in the database).** `public.notifications` is filled by triggers on the tables
that already record each event, so web, relayer, worker and reconcile all notify the same way:

| Event | Who is told |
| --- | --- |
| invitation by public ID | the invitee |
| a player joins | the creator (never the joiner) |
| a sponsorship | the creator and every player (never the sponsor) |
| a day result recorded on-chain, and again if a dispute upgrades it | the player |
| a challenge settles or is cancelled | every player |
| a reward, refund or sponsor refund arrives | its owner |
| a dispute is approved, rejected, resolved or expires | its owner |
| a badge is awarded (Phase 34 awards them) | its owner |

Each notification carries a `dedupe_key`, and `unique (profile_id, dedupe_key)` means a retried write
never creates a second one.

**UTC deadline warnings.** pg_cron `codestreak-deadline-warnings` runs `private.send_deadline_warnings()`
every minute. It is pure SQL and doesn't wake the worker. A day ends at `start + (day + 1) × length`, in
UTC. The warning goes out **3 hours** before the end on real (12 h+) days, or a quarter of the day before
on short demo days (`private.warning_lead_secs`, mirrored in `packages/shared/src/deadline.ts`). It goes
only to active players whose day is still unverified:
- no verified result for the day;
- no Shield;
- the latest "Check now" didn't meet the goal under the ANY/ALL rule.

There is one warning per player per day, and it says the UTC end time and the minutes left.

**Notification centre.** A bell in the header shows the unread count and the newest notifications. It
updates in real time through Supabase Realtime (the table is in the publication; RLS sends each user only
their own rows), and reloads after a reconnect or when the tab comes back. **Dashboard → Notifications**
has the full list with filters (Deadlines, Results, Money, Groups) and *Mark all read*. Clicking a
notification marks it read and opens its page. `mark_notifications_read()` changes only `read_at`, and only
on your own rows. Read notifications older than 60 days are pruned.

**Verification intelligence.** The challenge page has **Your days, explained** (`#my-days`): every recorded
day, taken from its sealed receipt, with:
- the verdict;
- a **confidence meter** marking the thresholds (≥ 50 can pass, ≥ 80 can fail);
- the reason, and the ANY/ALL rule;
- what the confidence gate did;
- for each provider: progress against the goal, its confidence, and how that was reached (for example
  "Incomplete data (starts at 60) × 100% coverage − 10 for 1 gap = 50");
- every counted item, and every skipped item with its reason.

`explainReceipt()` recomputes all of it from the receipt's own inputs with the rules engine and flags a
receipt whose stored numbers don't match.

**Coding insights.** **Dashboard → Insights** shows: recorded days, success rate (verified ÷ decided),
current and longest streak (a Shield keeps it alive), commits and problems that counted, an 8-week ISO
summary (Monday to Sunday, UTC: passed / shielded / undecided / failed, plus commits and solves), and
verified days by weekday. It is computed by `computeInsights()` only from your own on-chain-recorded
results, Shields and counted evidence. Previews are excluded, and the page says how many days it's based on.

**Tests:**
- SQL `99i_smart_alerts_test.sql`:
  - recipients for joins, results, sponsorships, settlement and payouts (and nobody else);
  - a result notification only once it's on-chain, and once;
  - the UTC lead (3 h / quarter-day / ≥ 1 min);
  - warnings only inside the window, only for the unverified player, with the UTC time in the title;
  - not twice; not for shielded or met days; not after the last day;
  - Realtime publication membership;
  - RLS: each user sees only their own; no direct update or insert; mark-read own only and idempotent;
    anon refused.
- shared:
  - `deadline.test.ts`: UTC day ends and windows, edges;
  - `notifications.test.ts`: Realtime inserts, replayed inserts not duplicated, read-state updates,
    mark some/all;
  - `explain.test.ts`: pass, gated-to-undecided, confident fail under ANY, and tampered numbers flagged;
  - `insights.test.ts`: ISO weeks, streaks with Shields, success rate, weekly and weekday counts.

## Phase 34: Soulbound badges (S)

Every player who survives a challenge gets a **soulbound badge**: a Token-2022 NFT (supply 1, 0
decimals) minted by the program into their own wallet. It shows in Phantom and on Solana Explorer, and
it can't be moved.

**Program: `mint_badge`** (`programs/codestreak/src/instructions/mint_badge.rs`). The chain is the only
gate:

| Rule | How it's enforced |
| --- | --- |
| Survivors only | `participant.finalized && status == Survived`, else `NotSurvivor`. This covers active, failed and voided players, unfinalized survivors, and cancelled challenges (which never finalize). |
| Once per player per challenge | The mint is the PDA `["badge", participant]`, and it must still be an empty system account, else `BadgeAlreadyMinted`. |
| Nobody can mint more or change it | Mint, freeze and metadata-update authority are all the program PDA `["badge_authority"]`, which only signs inside `mint_badge`. That instruction mints exactly 1, once. |
| Can't be transferred | The mint has the **NonTransferable** extension. Token-2022 refuses every transfer (holders' accounts get NonTransferableAccount and ImmutableOwner from the ATA program). |
| Always to the player | `user` must equal `participant.user`, and the token account must be that wallet's Token-2022 ATA (`ConstraintAddress` otherwise). Anyone may pay. |
| The payer can't change what it says | Name `CodeStreak Survivor · N days`, symbol `STREAK` and URI `https://codestreak-k0uv.onrender.com/api/badges/<participant>` are fixed in the program, not arguments. |
| Can't be blocked | Sending SOL to the mint address first doesn't stop it. The mint is created by top-up, then `allocate` and `assign` signed by the PDA, not `create_account`, which fails on a funded address. |

Metadata lives **on the mint itself**: a MetadataPointer pointing to the mint, plus the Token-2022
metadata extension. No Metaplex.

**Worker.** After settlement, the verification job:
- mints each Survived player's badge (step 5, verifier pays, ~0.004 SOL rent per badge);
- reads the chain before every attempt, so a lost confirmation never mints twice, and a badge someone
  else paid for is just mirrored, with its transaction found on the mint address;
- records the badge with `record_badge()` (service role only), which refuses non-survivors and a second,
  different mint for the same badge.

`verification_work` has a new reason, `badge`: a settled challenge with a survivor whose badge isn't
mirrored. `challenges.badges_checked_at` backs off for 10 minutes after each attempt, so a mint that keeps
failing (for example before the program upgrade) doesn't run every minute. The existing `notify_badge`
trigger tells the player and links to the badges page.

**Web:**
- **Dashboard → Badges** shows every challenge you survived, its badge image and state:
  - **In your wallet**, checked on-chain (the badge account holds 1);
  - **Minted**;
  - **Minting soon**.

  Each badge links to the token on Explorer, the mint transaction and the metadata. The challenge page
  shows the same line after settlement.
- `GET /api/badges/<participant>` (public, CORS) returns the JSON wallets and explorers read: name, symbol,
  description, image, attributes and `external_url`. Private challenges aren't named or linked.
  `…/image` returns a self-contained SVG with every user string escaped, served with a strict CSP. Both
  return 404 for anyone who didn't survive. `badge_metadata()` is service-role only, like every SECURITY
  DEFINER function.

**Devnet upgrade needed.** The program grew from ~507 KB to ~562 KB. `scripts/wsl/deploy-devnet.sh` now
extends ProgramData first when the build is bigger. Until the upgrade, badge mints fail with an unknown
instruction, and are retried every 10 minutes.

**Tests:**
- LiteSVM `tests/badges.rs`:
  - a survivor gets exactly one badge (Token-2022 owner, supply 1, 0 decimals, name, symbol and fixed URI
    on the mint);
  - a transfer to another wallet fails, and balances are unchanged;
  - an unfinalized player and a failed player both get `NotSurvivor`;
  - a double mint gets `BadgeAlreadyMinted`;
  - SOL sent to the mint address first doesn't block the mint;
  - swapping in another wallet gets `ConstraintAddress`.
- SQL `99j_soulbound_badges_test.sql`:
  - the crank picks the badge step;
  - a non-survivor is refused;
  - recording is idempotent, notifies once and logs once;
  - a second mint is refused;
  - work clears once minted;
  - metadata only for survivors;
  - the 10-minute backoff;
  - users and anon are refused.
- Worker `run.test.ts`:
  - only survivors are minted, never twice;
  - a mint that landed with a lost confirmation is mirrored without a second mint.
- Shared and web: the badge PDAs; the IDL has `mint_badge`; friendly errors; the metadata JSON (name
  ≤ 32 bytes, private challenges unlinked); SVG escaping.

## Phase 35: Developer dashboard (M)

`/dashboard` opens on a live overview of your coding streak and money. Every widget reads your own records
with your session (RLS), so it can only show what you're allowed to see. The logic is pure and tested
(`packages/shared/src/dashboard.ts`), and the loader is `apps/web/src/lib/dashboard/load.ts`.

| Widget | Where the data comes from |
| --- | --- |
| **Current streak**, longest, success rate | On-chain-recorded day results and Shields (`computeInsights`, as on Insights). |
| **Active challenges**, **stake at risk** per token | Your memberships in open challenges that haven't ended. |
| **Today's status** | In order: the recorded result; a Shield; the latest "Check now" (any provider met → *Goal met, waiting to be recorded*; below → *Below the goal so far*; incomplete → *Data incomplete*); otherwise *Not checked yet*. An earlier uncovered failure shows *Streak lost in this challenge*. |
| **Potential payout** | `computeSettlement()` if every player still in (no uncovered failure) finishes: stake + an equal share of the forfeits, sponsorships and Shields. Labelled as an estimate. 0 once you're out. |
| **Countdown** | The running day's end (or the start). Ticks every second. Shown in **UTC and IST** (UTC+05:30, no daylight saving). It turns amber inside the Phase 33 warning window while today isn't met. |
| **Deadlines** | Upcoming joining close, start, current and next day ends, and the last day, soonest first, each in UTC and IST with a countdown. |
| **Recent receipts** | Sealed day receipts recorded on-chain (verdict, receipt hash, record transaction) and payouts (amount, transaction), newest first, linked to devnet Explorer. |
| **Activity chart** (Recharts) | The last 30 UTC dates, with empty days included. Stacked bars: verified, shielded, undecided and failed days. Lines: commits and solves that counted. |

**Live.**
- The page follows your notifications over Supabase Realtime: a day result, payout, badge, settlement or
  deadline warning reloads the data at once.
- It also reloads when a countdown reaches zero (a new day starts), every minute while the tab is visible,
  and when you come back to the tab.

**Audio.** Short cues synthesised in the browser with the Web Audio API: no files, no voice, no paid
service.
- Chime: a deadline enters its warning window while you're unmet.
- Rising tone: a verified day.
- Low tone: a missed day.
- Coin: a payout or badge.

Sound is **off** until you press *Sound on* (browsers allow sound only after a click). The choice is
remembered in this browser.

**Brand-new user.** A welcome card shows three steps (link GitHub or LeetCode, link a wallet, join or
create a challenge), each marked done when it's done. Every widget has its own empty state, with no zeros
pretending to be data. Today shows a *Browse challenges* button.

**Tests:** `dashboard.test.ts` covers:
- today's status precedence (record > Shield > check), and "out" after an uncovered failure but not a
  shielded one;
- stake and potential payout (sponsored, with forfeits), 0 for a player who is out, and no throw when the
  mirrored player count lags;
- the warning only inside the window and only while unmet;
- deadlines (only active challenges, soonest first, before and after the start);
- stake at risk per token;
- the 30-day series (empty days filled, results and evidence bucketed, out-of-window results ignored);
- UTC and IST clocks across midnight; countdown text;
- entering the warning window detected exactly once.

**Full history** (`/dashboard/history`, linked from the dashboard and from Recent receipts). Every
challenge you played or sponsored, one row each, newest first:
- outcome: running, awaiting settlement, survived, failed, voided, cancelled or sponsored;
- dates (UTC);
- recorded days (verified / failed / shielded / undecided);
- what you put in and what came back;
- your badge, if you have one.

Several sponsorship top-ups on one challenge add up to one row.
- **Filters:** role, outcome, token and title search, as URL parameters, so a filtered view can be
  bookmarked. Unknown values fall back to "all".
- **Summary:** challenges, survived · failed, verified days, and in → back per token.
- **Export CSV** downloads exactly what's filtered (`/dashboard/history/export`):
  - signed-in only, your rows only, `no-store`;
  - Excel-safe: UTF-8 with a BOM, CRLF line ends;
  - any title starting with `= + - @` is neutralised, so a hostile challenge title can't run as a
    spreadsheet formula.
- **Tests:** `history.test.ts` covers outcomes, filter parsing from untrusted input, filtering and
  sorting, the summary, and CSV quoting and formula neutralising.

## Phase 36: Leaderboards (M/S)

`/leaderboards` (in the header nav) has **Global** (public challenges only, the same for everyone) and
**group** boards (any challenge you can see; your groups are listed as chips, and each challenge page
links to its own). Each has five tabs, ranked by `buildLeaderboard()` in
`packages/shared/src/leaderboard.ts`, from on-chain-recorded results and payouts only:

| Board | Score |
| --- | --- |
| This week | Days kept (verified, or covered by a Shield) whose window started since Monday 00:00 UTC |
| Longest streak | Most consecutive kept days across all challenges, in time order (same rule as Insights). Ties: current streak. |
| Most consistent | Verified ÷ (verified + uncovered failed), at least 3 decided days. Ties: more decided days. |
| Top earners · USDC / · SOL | Reward above the stake from payouts after settlement, survivors only. Per token, never mixed. |

Ranking is competition style (1, 1, 3): equal scores share a rank, and order inside a tie is by name.

**Live.**
- The page subscribes over Supabase Realtime to `challenge_activity`, which existing triggers bump on
  every recorded day, membership, payout and challenge change. RLS filters it, so a private group's
  changes reach only its members.
- On a change it re-fetches `/api/leaderboards` (debounced: 0.3 s for a group, 1.2 s for global, so one
  worker run that records many days re-ranks once).
- It resubscribes with backoff after errors, catches up after any disconnect or when the tab comes back,
  and re-ranks every 5 minutes so "This week" rolls over on Monday even without activity.

**Animated rank changes.** Rows animate to their new place (`motion` layout). A row that moved shows ▲n /
▼n, and a newcomer shows *New*, for 4 seconds. Reduced motion is respected.

**Privacy.**
- Global never includes private groups.
- A private group's board is a 404 for non-members, on the page and on the API.
- Everything is read with the viewer's session (RLS).

**No migration** (the Realtime table already exists).

**Tests:** `leaderboard.test.ts` has a hand-computed fixture of 5 players across 4 challenges and 2
tokens:
- the week boundary;
- a Shield inside a streak;
- the 3-day minimum;
- SOL and USDC kept apart;
- a payout equal to the stake isn't earnings;
- tie ranks (1, 1, 3) and tie-breakers;
- the limit;
- rank movement (up, down, new).

## Video 1 review fixes

Found by watching the three Video 1 recordings, and confirmed in the Render logs and the database.

- **Pages crashed after a dispute was resolved.** User 2's challenge page and Dashboard → Disputes
  returned "This page couldn't load" (a 500). The dispute ticket, a server component, called
  `explorerTxUrl()` imported from a `'use client'` module, which only runs once a dispute has an on-chain
  transaction. The fix imports it from `@codestreak/shared/program`. A new test,
  `client-boundary.test.ts`, fails CI if any server file imports a non-component from a client module.
- **No error or 404 pages existed**, so one failure blanked the whole app (no header, no nav).
  - `app/error.tsx` keeps the layout and offers Try again / Dashboard / Challenges, plus a reference id.
  - `app/not-found.tsx` explains "doesn't exist, or you don't have access (admin pages)", with links.
  - `app/global-error.tsx` is the last resort.
- **A valid challenge could show 404.** An RPC failure (devnet 429 rate limits) was treated as "account
  doesn't exist". Now only a real missing account is a 404; RPC errors go to the retryable error page.
- **Slow pages (20+ s) under devnet rate limiting.**
  - New `lib/chain/read-cache.ts`: concurrent reads share one request, a value stays fresh for a few
    seconds, and the last good value is served while the RPC returns 429.
  - The chain clock is read at most every 5 s and advanced locally.
  - The background member sync runs at most once per 30 s per challenge.
- **"View checks" could stay on "Loading…" forever.** It now times out after 15 s with an error and a
  Try again button.
- **Times in the browser's locale** (`11/24/2026, 8:20:00 PM`) in the dispute form, ticket timeline,
  payouts and admin review. They now use one deterministic format, "24 Nov, 14:50 UTC · 24 Nov, 20:20
  IST" (`utcAndIst`). That also removes a hydration mismatch.
- **Dispute form:** days already covered by a Shield are labelled "(covered by a Shield: only corrects
  the record)" and listed after the days that cost the streak.
- **A refund never shown** ("Demo challenge 6HLS"). Reconcile had added a member who joined outside the
  app with `claimed_at` but no amount, and the payout step skipped them.
  - The worker now mirrors any member who is claimed on-chain but has no payout recorded.
  - `record_payout` fills a missing amount without overwriting a recorded one.
  - Migration `payout_mirror_fix` re-queues affected challenges.
  - Tests: worker and SQL `99k`.
- **"Your challenges" redesigned** (dashboard):
  - grouped into **Active**, **Finished** and **Cancelled** (collapsed), with counts;
  - each row shows **your result** (Playing, Survived, Failed, Voided · refunded, Refunded, Refund on its
    way, Cancelled · nobody joined…) and **your money**: stake → received, with +/− net;
  - links to Full history.

Verified correct in the recordings (no change needed):
- the under-minimum challenge auto-cancelled (you created it but didn't join, so there was no stake to
  refund);
- day results were recorded on-chain;
- Shields covered missed days;
- the dispute upgraded Failed → Verified on-chain;
- settlement and the automatic reward were exact (0.14 SOL = stake + forfeited stake + 2 Shield fees);
- non-admins get 404 on `/admin/disputes`;
- **reconcile reset your `participant_count` edit from 5 back to 2** at 15:05 UTC and logged
  `reconcile.challenge_fixed`.

## Video 2 review fixes

Checked against both recordings, the database and the live endpoints.

**Verified correct (no change needed).** Scene 3's data was right:
- Video2 Demo's days were recorded on-chain about 3 minutes after each day ended;
- the matching "Day N verified / missed" notifications fired in the same second;
- the deadline warning went **only** to the player whose day wasn't met yet.

Also correct:
- the badge mint on Explorer: Token-2022, supply 1, decimals 0, NonTransferable + MetadataPointer +
  TokenMetadata;
- the metadata JSON at `/api/badges/<participant>` (the black page in the video was Render waking up).

**Fixes**
- **A Shield was offered for a day that had already passed its check.** A bought one, and it was wasted
  when the day was verified. When your latest "Check now" for a day met the goal (and it isn't recorded
  as missed), the Shield row now says *Goal met · no Shield needed* and hides the buy buttons behind
  *Buy one anyway*. The check is a preview, so the option stays. A day the chain recorded as verified was
  already blocked.
- **Recent receipts mislabelled payments.** A join stake showed as "Sponsor refund". Every receipt kind
  now has its own label (Stake paid, Shield bought, Sponsorship, Reward, Refund, Sponsor refund), with −
  for money out and + for money back.
- **Leaderboards layout redesigned.**
  - Before: every challenge was a chip in one wrapped row.
  - Now a **Global / My groups** switch, and your groups in **one dropdown** grouped into Running /
    Finished / Cancelled with start dates, newest first.
  - The selected board has a header card (name, who it covers, Live dot, player count).
  - Equal-width tabs, the rule in one line, a **top-3 podium**, then the ranked list.
- **The badge in wallets.**
  - The artwork is now a **PNG** (Next `ImageResponse`, no new dependency); many wallets refuse SVG.
  - The Badges page explains that Phantom's devnet view doesn't list Token-2022 badges that keep their
    metadata on the token, and that Explorer always shows them. The badge *is* in the wallet: the page
    checks the token account on-chain.

## Phase 37: Public profile `/u/[username]` (M)

A shareable profile that works **logged out** (no sign-in redirect, with Open Graph title and
description). It shows:
- **Header:** avatar (the profile's own, else the GitHub picture, else initials), display name,
  @username, public ID, member since, **linked accounts** (GitHub / LeetCode handles linking to their
  public pages), and **Share profile** (system share sheet, or copy the link).
- **Stats:** current and longest streak, success rate, survived N of M, **rewards earned** (above the
  stake, per token). Same rules as Insights: on-chain-recorded days only, and Shields keep a day.
- **Soulbound badges, read from chain:** each badge's Token-2022 account balance is read on-chain (cached
  60 s), shown as *Held in wallet · read from chain*, with an Explorer link.
- **History:** every public challenge with dates, result, days ✓/✗/🛡, stake → received and **tx links**
  (Join, Payout, Badge on Explorer).

**Private groups never leak.**
- The loader is the only service-role reader. Every query is scoped to the one profile **and**
  `challenges.visibility = 'public'`, and selects only displayed columns: no email, timezone or auth id.
- `buildPublicProfile()` (shared, pure) drops every non-public or address-less row **again**, so a private
  group can't affect a list or even a total.
- The test checks that a private group's title, address, join tx, badge mint and mint tx appear nowhere
  in the output, and that its failed days don't move the success rate.
- The page says "Public challenges only".

**URLs.** `usernameFromPath` accepts `Chirag`, `@chirag` and `%40chirag`. Anything else, malformed
escapes included, is a 404 with the friendly not-found page.

**Links.** Dashboard → *Public profile @you*, and every name on the leaderboards links to that player's
profile.

No migration and no new environment variables.

### Phase 37 follow-up: your achievements count, private details stay hidden

Feedback: "@chirag" showed 0 survived and no badge, although the 3-day badge and the win came from
**Video1 Demo, a private group**. Hiding private groups entirely was too strict.

**What a profile shows now:**
- **Totals** (streak, success rate, survived, rewards) include private groups as **numbers only**. They
  match the dashboard.
- **Badges** include private ones as **"Private challenge (details hidden)"**: no title, link, mint or
  transaction. The on-chain wallet check still runs.
- **History** lists public challenges, then "+ N private challenges (details hidden)".
- **Survived** reads "N of M finished" (cancelled and running challenges no longer count against you).

**Never shown for a private group:** its title, address, dates, members, days, transactions or badge
mint. `buildPublicProfile()` builds each private badge field by field, so nothing can be copied across.
Tests:
- no private title, address, join tx, mint or mint tx appears anywhere;
- private days do move the success rate;
- the anonymous badge has exactly the expected fields.

**Other changes:**
- New result **Refunded · nobody survived**, for a failed player paid back in full because nobody
  survived. Video2 Demo: 0.01 → 0.02 SOL, which is stake + Shield. Used in History and on profiles.
- Profiles re-read their data every minute while open, and when you come back to the tab.
- Data: *Demo challenge 6HLS* was re-queued after the new worker deployed (the old worker had marked
  it done first). Its 1 USDC refund is now recorded.

## Phase 37.1: Developer Control Center (`/admin`)

**Who can open it.** Exactly one owner, no roles:
- env `CODESTREAK_OWNER_ID` + `CODESTREAK_OWNER_EMAIL_SHA256` (or the plain `CODESTREAK_OWNER_EMAIL`), compared in constant time against the Auth server's user (`getUser()`, not a cookie claim), and the email must be confirmed;
- and the single row in `public.admins` (a unique index on `((true))` makes a second admin impossible);
- and every database function re-checks with `private.assert_owner(p_actor)`. Admin functions are executable by `service_role` only.
Anyone else gets a plain 404. The header "Control Center" button shows only for the owner (`am_i_admin`), but it is a convenience: the server checks every page and action.

**Sensitive actions** (ban, permanent suspension, scheduling or finalizing deletion, username change) need a sign-in within the last 30 minutes and the username typed to confirm.

**Writes.** One call, `admin_moderate(actor, target, action, reason, params, request_id)`: validates, changes state, records the action with before/after snapshots, appends the audit entry and notifies the user, all in one transaction. A reason (5+ characters) is mandatory, self-moderation is refused, and the same `request_id` replays instead of acting twice (double-clicks, retries).

**Audit.** `admin_audit` is append-only (triggers refuse update/delete/truncate). Each row stores `hash = sha256(prev_hash || canonical row)`; appends are serialized with an advisory lock. "Verify hash chain" recomputes everything and names the first broken entry. Opening a user's full record is logged too (`view.user_detail`).

**Enforcement.** In the app, not Supabase Auth bans, so a suspended or banned user can still sign in, see why at `/dashboard/account`, and appeal:
- proxy: suspended / banned / pending deletion → only `/dashboard/account`;
- relayer: join, Shield, create (`challenges`), private create (`groups`), sponsor (`sponsorship`) check `account_gate`, failing closed;
- database trigger: blocked users can't send invitations;
- public profile: hidden, banned or deleted → 404 (same as missing).
Expired suspensions read as active at once and are cleared by pg_cron every 10 minutes. Payouts and refunds are never blocked (the backend never moves escrow funds). The program itself refuses entries that skip these checks once its entry gate is on (Phase 37.2).

**Deletion.** Scheduled with a 1–30 day grace period (appealable, cancellable). Finalizing anonymizes the profile, removes linked accounts, wallets and notifications, and locks Auth login. On-chain history and financial receipts stay (they are public and needed for audit).

**Reports & appeals.** Users report a profile from its page (`report_user`: signed in, not yourself, 5 a day, one open per person) and appeal from `/dashboard/account` (one open at a time). Users see only the action and date of their history (column grants), never internal reasons or notes.

**Chat moderation (future, not built).** `report_target` already has `message`. When chats exist: users report a message, the report stores the message id plus a SHA-256 of its text at report time (tamper evidence), the Control Center shows only reported messages with a little surrounding context, and every view is an audited `view.message` entry. No browsing of private chats.

**Tests.** `supabase/tests/99l_control_center_test.sql` (owner checks, idempotency, failed actions change nothing, confirmations, self-ban refused, username uniqueness, deletion grace, chain verify + tamper detection, user cannot write moderation state or read reasons, appeals, report limits), `lib/admin/identity.test.ts`, `lib/auth/routes.test.ts` (blocked redirect).

**Try it.** Sign in as the owner → header "Control Center" → Users → search → open a user → Take action → Warn (reason) → the user gets a notification, Audit Logs shows the entry, "Verify hash chain" says intact. Suspend a test user for 1 hour → as them, every protected page goes to `/dashboard/account` with the reason and an appeal form → submit → back as owner, Reports & Moderation → Accept & reinstate.

## Phase 37.2: On-chain entry gate

**Problem.** Phase 37.1 blocked moderated users in the app, the relayer and the database, but the program was open: a suspended user with devnet SOL could build a join, create or sponsor transaction themselves. The reconcile job would then mirror that join (it comes from their verified wallet) and the verifier would record their days.

**Fix.** A global `EntryGate` account (PDA `["entry_gate"]`) set by the config admin with `set_entry_gate(authority)`. When it holds a key, `initialize_pool`, `join_pool` and `sponsor_pool` require that key as the rent **payer**. In production that is the relayer, which signs only after the server's checks. A direct transaction fails on-chain with `EntryNotApproved`. It applies to every challenge at once, old ones included, because the gate is global and read on each entry.

**Never gated** (so funds can't be trapped): `claim_reward`, `claim_refund`, `claim_sponsor_refund`, `finalize_participant`, `settle_challenge`, `cancel_pool`, `mint_badge`, `record_verification`, and `activate_shield` (it only protects a stake already in). If CodeStreak's server is down, nobody can enter a challenge, but everyone can still leave with their money.

**Where the checks live (all server-side).** The relayer service checks `account_gate` when it prepares a transaction and again when the signed transaction is submitted, then co-signs as payer. A blocked user gets one clear message from the server (status, reason, where to appeal), not a hidden button. Someone who sends a transaction directly gets `EntryNotApproved`, shown as "CodeStreak has to approve this action...". The relayer policy also refuses a rent payer other than the relayer and a wrong gate account.

**Remaining window.** The relayer pre-signs at prepare time, so a user who is suspended in the ~60–90 seconds before that blockhash expires could still broadcast the already-approved transaction themselves. After that it can't be replayed.

**Rollout (no downtime).** Until `set_entry_gate` runs, the gate account doesn't exist and entry stays open exactly as before, so the upgraded program and the new web build can go out in either order:
1. merge, let Render deploy the web app;
2. WSL: `bash scripts/wsl/deploy-devnet.sh` (upgrades the program);
3. Windows, repo root: set `ADMIN_KEYPAIR_PATH` in `.env.local` (path to `admin.json`), then `pnpm devnet:set-entry-gate`.
Undo in an emergency: `pnpm devnet:set-entry-gate --off`.

**Tests.** `programs/codestreak/tests/entry_gate.rs`: open without a gate (backwards compatible), only the admin sets it, a self-paid join, sponsor or create is refused, the relayer path works, a fake gate account fails the seeds check, Shields and refunds stay open with the gate on, clearing it reopens entry. `packages/shared/src/relayer/index.test.ts`: gate PDA filled automatically, wrong gate and non-relayer payer refused.

## Phase 37.3: Badges show as NFTs in wallets

**Problem.** Badges were correct on-chain (Solscan showed name, image and attributes), but Phantom didn't list them. Solscan filed them as a "Fungible Asset": the mint still had a mint authority (and a freeze authority), the program's badge PDA. Wallets and indexers only treat a token as an NFT when it has 0 decimals, supply 1 and **no mint authority**.

**Fix (no Metaplex, no new dependency, no extra cost).**
- `mint_badge` creates the mint with no freeze authority and, right after minting the single badge, removes the mint authority (`SetAuthority MintTokens → None`, signed by the badge PDA). The supply is fixed at 1 for ever. Name, symbol, URI, NonTransferable and the metadata update authority are unchanged.
- New permissionless `seal_badge(participant)` does the same for badges minted before the upgrade: it removes the mint and freeze authority if the badge PDA still holds them, and does nothing if it's already sealed. It moves no tokens, can only take authority away, and refuses a mint that isn't a 1-supply, 0-decimal badge (`NotABadge`).

**What doesn't change.** One badge per player per challenge (mint PDA), soulbound (NonTransferable), metadata JSON, the worker's mint flow and its accounts, profile and wallet checks (they read the token balance).

**Rollout.**
1. merge;
2. WSL: `bash scripts/wsl/deploy-devnet.sh`;
3. Windows, repo root: `pnpm devnet:seal-badges --dry-run` (lists old badges), then `pnpm devnet:seal-badges` (relayer pays the fees).
Phantom may take a while to re-index. Check Collectibles and its hidden list with Testnet Mode on devnet. Whether Phantom shows devnet collectibles, and its spam filter, are Phantom's decisions; Solscan and the app's badge pages remain the proof.

**Tests.** `programs/codestreak/tests/badges.rs`: a new badge has no mint or freeze authority; an old-style badge is sealed by anyone, keeps supply, owner and metadata, and re-sealing is a no-op; sealing fails for a player without a badge.

**Later, only if still needed:** Metaplex Core (bigger change, new dependency, higher rent per badge).

## Phase 38: Widget and share card

**Widget, three ways** (public, no sign-in, `?theme=light` optional; dark by default):
- **Image:** `/api/widget/<username>.svg`, `.png`, `.jpg`. For a GitHub README: `[![me on CodeStreak](…/api/widget/me.svg)](…/u/me)`. The SVG is hand-built: no scripts, no external resources, user text XML-escaped, served with a `default-src 'none'` CSP and `nosniff`. PNG is drawn with Next's ImageResponse; JPG is that PNG re-encoded with sharp (already shipped with Next, now a direct dependency); if sharp is missing it redirects to the PNG.
- **iframe:** `/embed/<username>`, a complete tiny HTML page with inline CSS and **no JavaScript**, allowed in frames on any site (`frame-ancestors *`), `noindex`, linking to the profile in a new tab.
- **Profile page → Embed:** preview, dark/light, and copy buttons for Markdown, HTML image and iframe, plus SVG/PNG/JPG links.

**Dynamic social image.** `/u/<username>` now has `opengraph-image` and `twitter-image` (1200×630, same design) and `summary_large_image` metadata, so pasting a profile link into X, LinkedIn, Slack or WhatsApp shows the card. `metadataBase` comes from `APP_URL`, so image URLs are the public ones on Render.

**Data and privacy.** Everything comes from the Phase 37 public-profile loader. Private groups count as numbers only, and hidden, banned or deleted accounts look exactly like unknown ones. No avatar is fetched (initials only), so a profile can't make the server request arbitrary URLs. Display names that image renderers can't draw (emoji, other scripts) fall back to `@username`.

**Unknown user.** Any unknown, hidden or malformed name returns a clean "Profile not found" card in the requested format with status 200 (so every `<img>` and iframe shows it) and `X-CodeStreak-Profile: not-found`. If the database lookup itself fails, the placeholder is sent with `no-store` so it isn't cached.

**Caching.** Real cards: `max-age=600, stale-while-revalidate=86400` (updates within about 10 minutes). Placeholders: 60 seconds.

**Plain HTML page.** `/widget-demo.html?u=<username>` (also works saved to disk and opened from a file) embeds the iframe, the SVG, the PNG and the JPG with no framework.

**Tests.** `packages/shared/src/widget.test.ts`: model, placeholder, URL parsing, escaping (a `<script>` name can't inject), no scripts or external resources in the SVG, HTML page without JavaScript linking to the profile, snippets.

## Phase 39: Blinks (Solana Actions)

**Endpoints** (public challenges only; private groups answer like unknown ones, so nothing about them leaks):
- `GET /actions.json`: rules `/challenges/*` → `/api/actions/join/*` (a challenge link unfurls as its join Blink) and `/api/actions/**` → itself.
- `GET|POST|OPTIONS /api/actions/join/<challenge>`: one "Join for <buy-in>" button, disabled with a reason when joining has closed or the challenge is full.
- `GET|POST|OPTIONS /api/actions/sponsor/<challenge>?amount=`: three preset buttons plus a custom amount input (same limits as the app).
- `POST /api/actions/{join,sponsor}/<challenge>/done?key=`: the `links.next` callback after the wallet's transaction confirms. It returns a `completed` card.
- `GET /api/actions/icon/<challenge>.png`: 600×600 PNG icon (title, days, buy-in, players).

**Headers.** Every response, errors and `OPTIONS` included, carries `Access-Control-Allow-Origin: *`, `Allow-Methods GET,POST,PUT,OPTIONS`, `Allow-Headers Content-Type, Authorization, Content-Encoding, Accept-Encoding` (plus the `X-Accept-*` ones), `Expose-Headers`, `X-Action-Version: 2.4` and `X-Blockchain-Ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet). Errors are `ActionError` JSON (`{ "message": … }`) with 4xx/5xx: malformed account, missing or bad amount (empty, not a number, negative, zero, too many decimals, below the minimum, above the maximum), challenge closed, not public, wallet not linked.

**How a Blink transaction works with the entry gate (37.2).** POST reuses the app's relayer path (`prepareJoin` / `prepareSponsor`) for the CodeStreak account that verified the posting wallet, so every server check applies: moderation, linked coding accounts, balance, rules fingerprint, rate limit, SOL wrapping. The relayer is fee payer and entry-gate payer and **pre-signs**. The Actions spec allows a partially signed transaction, and the client must not change its fee payer or blockhash. The wallet adds only its own signature and sends it. The `done` callback accepts a signature only if that confirmed transaction's message hash equals the one prepared for this user and request, then mirrors it immediately (the same code as the in-app submit, now `finishConfirmed`). If the callback never comes, reconcile mirrors the join within 30 minutes.

**Who can use it.** The wallet must be linked to a CodeStreak account (Dashboard → Wallet); otherwise a clear `ActionError` says so. Without an account nobody could verify the player's days (or apply moderation), and the relayer would be paying for strangers.

**Try it.**
- Blinks Inspector: https://www.blinks.xyz/inspector, paste `https://codestreak-k0uv.onrender.com/api/actions/join/<challenge address>`.
- dial.to: `https://dial.to/?action=solana-action:https://codestreak-k0uv.onrender.com/api/actions/sponsor/<challenge address>&cluster=devnet`.
- curl checks: `curl -i -X OPTIONS …/api/actions/join/<address>` (204 + headers), `curl -i -X POST '…/api/actions/sponsor/<address>?amount=abc' -H 'content-type: application/json' -d '{"account":"<wallet>"}'` → 400 `{"message":"Enter a number like 5."}`.

**Tests.** `packages/shared/src/actions.test.ts`: headers, actions.json, account and amount validation (bad amounts → error), join/sponsor metadata (disabled states, presets, the `{amount}` parameter).

## Phase 40: Landing page

**Kept short on purpose.** The same headline and devnet badge as before, improved, plus five compact sections:
1. **Hero:** text and buttons on the left (Start a streak / Dashboard, Browse challenges). On the right, an **animated streak grid**: every UTC day of the last 12 weeks, filled from the day results recorded on-chain (all players together, no names). Cells fade in one by one. The app's Reduced setting and the OS setting turn that off, including the per-cell delay. A missed-only day gets a faint red ring.
2. **One row of live numbers:** players, challenges, days verified on-chain, badges minted (**from the database**, `public.landing_stats()`), and **in escrow now** (**read from Solana**: the balances of the challenge vaults not yet paid out, one batched `getMultipleAccountsInfo`, cached 60 s, per token, never mixed). Each number names its source. A number that can't be read shows "—".
3. **Open to join:** up to three **public** challenges still open for joining (soonest deadline first). Private groups never appear. With none, it says so and links to creating one.
4. **How it works:** four steps, plus one example verdict clearly labeled **"Demo · example data"**.
5. **Call to action**, then "Deployment details" (network, RPC, program) folded into a collapsed section.

**No fake numbers anywhere.** No hard-coded figures, no "10,000+ developers", no sample cards. The only invented content is the single example verdict, and it's labeled as a demo.

**Stats match database queries.** `supabase/tests/99m_landing_stats_test.sql` checks every figure of `landing_stats()` against the plain query, that the grid's 84 days add up to the recorded results of those days, that one new onboarded player moves "players" by exactly one, and that browsers can't call the function (service role only). Migration `landing_stats` is applied.

## Phase 41: Polish pass (mobile, loading, empty, error, motion)

**Phones (375 px).**
- **Header:** with a signed-in user the bar needed ~450–510 px (logo, Devnet, bell, Control Center, Profile, Dashboard, menu). Below the `md` breakpoint it now keeps only logo, Devnet, bell and ☰; Dashboard, Your profile and Control Center (owner only) are in the menu sheet under an "Account" section. From `md` up nothing changes, except the Control Center label shows from `lg` (icon only on tablets). The auth state is now loaded once (`useAuthState`) and shared by the bar and the menu.
- **Safety net:** `body { overflow-x: clip }`, so no page can scroll sideways as a whole (wide tables keep scrolling inside their own box; `clip` keeps the sticky header working). `.font-mono` wraps long addresses, signatures and IDs (`overflow-wrap: anywhere`); truncated ones are unaffected.
- **Dialogs** never exceed the screen height (`max-h: 100dvh − 2rem`, scrolling inside), so the action, report and embed dialogs work on short phones.
- **Dashboard** "Your public ID" row wraps on phones.

**Loading states.** `app/loading.tsx` (any page) and `app/admin/loading.tsx` (inside the Control Center layout) show skeleton shapes while server data loads. Shapes only, no fake text or numbers, announced once to screen readers. The shimmer stops when motion is reduced.

**Empty and error states.** Already in place from earlier phases and re-checked: every list has a plain-language empty state with a next step, and `error.tsx` / `not-found.tsx` / `global-error.tsx` cover failures. Nothing changed there.

**Motion.** One set of timings (`lib/motion.ts`: 150/240/420 ms, two springs). Reduced motion covers Motion components (`MotionConfig`), CSS animations and transitions (`html[data-motion]`), counters (jump to the value) and the landing grid (no per-cell delay). Re-checked, no changes needed.

**Manual checklist.** `docs/qa-checklist.md`: every page × (375 px, loading, empty, error, motion), signed out / user / owner, with what to look for. The starred rows are also checked at desktop width.
