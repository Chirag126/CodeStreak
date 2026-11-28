# CodeStreak

**Stake on your coding streak.** Players put SOL or USDC into a shared escrow, code every day (GitHub pushes or LeetCode solves, checked automatically), and the ones who keep their streak split the stakes of the ones who don't. Sponsors can add to the pot. Every deposit, day result, payout and badge is on Solana.

- **Live app (devnet):** https://codestreak-k0uv.onrender.com
- **Program (devnet):** [`A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J`](https://explorer.solana.com/address/A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J?cluster=devnet) — verified build, on-chain IDL and `security.txt`; [check it yourself](docs/verify.md)
- **Network:** Solana devnet only. No real money.

## How it uses Solana

- **Anchor program in Rust** (`programs/codestreak`): challenge pools with a program-owned token vault, joins, sponsorships, Shields (pay to cover a missed day), day results recorded by a verifier key, finalization, settlement and pull-based claims. Funds leave the vault only through a claim, only to the wallet that is owed them, once.
- **SOL and USDC** through the SPL Token program; SOL payouts arrive as wrapped SOL and can be unwrapped in the app.
- **Soulbound survivor badges**: Token-2022 NFTs (non-transferable, on-mint metadata) minted by the program into each survivor's wallet.
- **Gasless for players**: a relayer pays fees and co-signs; the program checks who may approve what (entry gate for private groups).
- **Blinks / Solana Actions**: a challenge link unfurls as a join or sponsor button.
- **Fast, cheap transactions**: compute limits from simulation, priority fees from the network, resend until confirmed or expired; the worker packs many players into versioned transactions with an address lookup table.
- **Trust**: reproducible build verified by OtterSec's devnet verifier, IDL on-chain (Program Metadata), `security.txt` in the binary.

## Repository

| Path | What |
|---|---|
| `programs/codestreak` | The Solana program (Anchor 1.x) and its LiteSVM tests |
| `apps/web` | Next.js app: challenges, wallet sign-in, relayer, Blinks, voice briefings |
| `apps/worker` | Background jobs: verify GitHub/LeetCode days, settle, pay out, mint badges, reconcile with the chain |
| `packages/shared` | Typed program client (from the IDL), rules engine, relayer policy, transaction helpers |
| `supabase` | Database schema, row-level security and tests |
| `scripts/wsl` | Devnet deploy (verifiable build), verification, environment checks |

`phase.md` records every phase of the build; `render.md` the hosting setup; `SECURITY.md` how to report a vulnerability.

## Checks

Every pull request runs the TypeScript checks and tests, the database migrations with their RLS and constraint tests, `anchor build` with the program's LiteSVM tests (including a 50-player challenge in versioned transactions), a secret scan of the whole history, and a check that `Cargo.lock` is complete for the reproducible build.

## License

MIT OR Apache-2.0 (the program crate); see `programs/codestreak/Cargo.toml`.
