# Security policy

CodeStreak is a hackathon project running on **Solana devnet** only. No real money is at stake, but we still want to hear about anything that could let someone take funds they are not owed, block a payout, or change a recorded result.

## Reporting a vulnerability

Please report privately through GitHub: **[Report a vulnerability](https://github.com/Chirag126/CodeStreak/security/advisories/new)**. Do not open a public issue for security problems.

Include what you found, where (program instruction, API route, worker job), and how to reproduce it. We aim to reply within 3 days.

## Scope

- The on-chain program `A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J` (devnet) in `programs/codestreak`.
- The web app and its API routes in `apps/web`, including the relayer that pays transaction fees.
- The worker in `apps/worker` (verification, settlement, payouts).

Out of scope: devnet faucet limits, rate limiting of the public devnet RPC, and issues in third-party services (GitHub, LeetCode, Supabase, Render, ElevenLabs).

## Verifying the program

The program on devnet is built reproducibly from this repository. To check that the deployed binary matches the source yourself, see [docs/verify.md](docs/verify.md). The same contact is embedded in the program binary as a `security.txt`.
