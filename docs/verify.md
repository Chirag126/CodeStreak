# Check the CodeStreak program yourself

The CodeStreak program runs on **Solana devnet** at

`A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J` — [Solana Explorer](https://explorer.solana.com/address/A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J?cluster=devnet)

You don't have to trust us that the program is the code in this repository. There are three ways to check, from easiest to most independent.

## 1. Look at the Explorer

The program page shows:
- **Verified**: OtterSec's devnet verifier (verify-devnet.osec.io) rebuilt the program from this repository and got the same bytes as the deployed program. The *Verification* tab names the commit.
- **IDL**: the program's interface, stored on-chain (Program Metadata). Transactions show instruction names such as `join_pool`, `claim_reward` and `record_verification` instead of raw bytes.
- **Security**: the program's `security.txt` — who to contact about a vulnerability ([SECURITY.md](../SECURITY.md)).

## 2. Run the check on GitHub

In this repository: **Actions → Verify devnet program → Run workflow**. It rebuilds the program in the pinned Docker image and compares its hash with the deployed program; the run summary shows both hashes. No keys, nothing uploaded.

## 3. Rebuild it on your own machine

Needs Docker and Rust.

```bash
cargo install solana-verify --version 0.6.0 --locked

# The hash of what is deployed
solana-verify -u devnet get-program-hash A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J

# Build a commit in the same Docker image and compare (answer "n" when asked to upload)
solana-verify -u devnet verify-from-repo https://github.com/Chirag126/CodeStreak \
  --program-id A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J \
  --library-name codestreak \
  --commit-hash <commit from the Explorer's Verification tab>
```

The build is reproducible because the Solana version is pinned (`[workspace.metadata.cli]` in `Cargo.toml`, the same as `Anchor.toml`) and every dependency is pinned in `Cargo.lock` (CI fails if it isn't).

You can also read the interface and the security contact straight from the chain:

```bash
anchor idl fetch A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J --provider.cluster devnet
solana program dump -u devnet A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J codestreak.so
cargo install query-security-txt && query-security-txt codestreak.so
```

## What the program can and can't do

- Money sits in a vault owned by the program; it leaves only through `claim_reward`, `claim_refund` or `claim_sponsor_refund`, and only to a token account owned by the wallet that is owed it, once.
- The backend's keys (relayer, verifier) can pay fees and record day results; they can't move escrowed funds.
- The program is upgradeable by its upgrade authority (devnet, hackathon project). Every upgrade changes the hash, so a verified mark always refers to the exact deployed bytes.
