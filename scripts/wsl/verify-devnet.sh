#!/usr/bin/env bash
# Phase 47: publishes the verified-build record of the CodeStreak program on DEVNET and asks the
# OtterSec devnet verifier (verify-devnet.osec.io) to rebuild it from GitHub, so explorers show the
# program as "Verified". Read-only for funds: it only writes the verification record (a PDA of the
# verify program, a few thousand lamports of rent) signed by the upgrade authority.
#
# Usage (WSL Ubuntu, repo root, after `bash scripts/wsl/deploy-devnet.sh`):
#   bash scripts/wsl/verify-devnet.sh
#
# Needs: Docker running, solana-verify (`cargo install solana-verify --git https://github.com/solana-foundation/solana-verifiable-build --rev 64a7fd490b4ea8f8c203d3268c24760529b17208 --locked`),
# and the deployed program built by `solana-verify build` from a commit that is pushed to GitHub.
set -euo pipefail

KEY_DIR="${CODESTREAK_KEY_DIR:-$HOME/.config/codestreak/keys}"
URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_ID="A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
REPO_URL="https://github.com/Chirag126/CodeStreak"
LIBRARY="codestreak"
AUTHORITY="$KEY_DIR/upgrade-authority.json"
SO="target/deploy/codestreak.so"

step() { printf '\n== %s\n' "$1"; }
fail() { echo "ERROR: $1" >&2; exit 1; }

[[ -f Anchor.toml ]] || fail "run this from the repo root (cd /mnt/c/dev/CodeStreak)"
[[ -f "$AUTHORITY" ]] || fail "upgrade-authority key not found at $AUTHORITY"
command -v solana-verify >/dev/null 2>&1 || fail "solana-verify not found: cargo install solana-verify --git https://github.com/solana-foundation/solana-verifiable-build --rev 64a7fd490b4ea8f8c203d3268c24760529b17208 --locked"
# The devnet verifier (verify-devnet.osec.io) is only chosen automatically from 0.6.0 on; 0.5.x
# would send the job to the mainnet verifier, which can't find a devnet program.
sv_version="$(solana-verify --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
case "$sv_version" in 0.[0-5].*) fail "solana-verify $sv_version can't submit devnet verifications; install the pinned version: cargo install solana-verify --git https://github.com/solana-foundation/solana-verifiable-build --rev 64a7fd490b4ea8f8c203d3268c24760529b17208 --locked" ;; esac
docker info >/dev/null 2>&1 || fail "Docker is not running (start Docker Desktop with WSL integration, or the docker service)"

step "Cluster"
case "$URL" in *mainnet*) fail "refusing a mainnet URL" ;; esac
genesis="$(solana genesis-hash --url "$URL")"
[[ "$genesis" == "$DEVNET_GENESIS" ]] || fail "$URL is not devnet (genesis $genesis)"
echo "devnet OK ($URL)"

step "Source"
# The verifier rebuilds from GitHub, so the deployed program must come from a commit that is there.
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "uncommitted changes: commit them, rebuild and deploy, then verify"
commit="$(git rev-parse HEAD)"
git fetch --quiet origin
[[ -n "$(git branch -r --contains "$commit")" ]] || fail "commit $commit is not on GitHub yet: git push, then run this again"
echo "commit $commit ($REPO_URL)"

step "Deployed program matches this commit's build"
onchain="$(solana-verify -u "$URL" get-program-hash "$PROGRAM_ID")"
echo "on-chain hash: $onchain"
if [[ -f "$SO" ]]; then
  local_hash="$(solana-verify get-executable-hash "$SO")"
  echo "local build:   $local_hash"
  [[ "$onchain" == "$local_hash" ]] || fail "the deployed program is not this build. Deploy it first: bash scripts/wsl/deploy-devnet.sh"
fi

step "Rebuild from GitHub, compare, upload the verification record"
# Clones the repo at the commit, builds it in the pinned Docker image, checks the hash against the
# chain, and only then writes the record (signed by the upgrade authority, as the verifier requires).
solana-verify -u "$URL" verify-from-repo "$REPO_URL" \
  --program-id "$PROGRAM_ID" \
  --commit-hash "$commit" \
  --library-name "$LIBRARY" \
  --keypair "$AUTHORITY" \
  --skip-prompt

step "OtterSec devnet verifier"
authority_pk="$(solana-keygen pubkey "$AUTHORITY")"
if ! solana-verify -u "$URL" remote submit-job --program-id "$PROGRAM_ID" --uploader "$authority_pk"; then
  echo "The verification record is on-chain; only OtterSec's devnet verifier (verify-devnet.osec.io) could not be reached." >&2
  echo "Submit again later (no rebuild needed): solana-verify -u $URL remote submit-job --program-id $PROGRAM_ID --uploader $authority_pk" >&2
  exit 1
fi
solana-verify -u "$URL" remote get-status --program-id "$PROGRAM_ID" || true

step "Done"
echo "Explorer (Verified badge, security.txt, IDL): https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
