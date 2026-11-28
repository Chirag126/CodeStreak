#!/usr/bin/env bash
# Builds and deploys (or upgrades) the CodeStreak program on Solana DEVNET, uploads its IDL, and
# (Phase 47) publishes it as a verified build.
#
# Usage (WSL Ubuntu, from the repo root):
#   bash scripts/wsl/deploy-devnet.sh               # verifiable build + deploy/upgrade + IDL + verify
#   bash scripts/wsl/deploy-devnet.sh --quick       # plain `anchor build` (not verifiable), no verify
#   bash scripts/wsl/deploy-devnet.sh --skip-build  # deploy the existing target/deploy/codestreak.so
#
# The verifiable build runs `solana-verify build` in a pinned Docker image (Solana 3.1.10, from
# [workspace.metadata.cli] in Cargo.toml), so anyone can rebuild the same bytes from GitHub. It needs
# Docker and solana-verify (`cargo install solana-verify --git https://github.com/solana-foundation/solana-verifiable-build --rev 64a7fd490b4ea8f8c203d3268c24760529b17208 --locked`), and a clean,
# committed tree (the verification names the commit).
#
# Safety:
#   - refuses to run unless the RPC endpoint's genesis hash is devnet's;
#   - the program ID must match declare_id! / Anchor.toml (keypair restored from your key backup);
#   - signs with the upgrade-authority key in ~/.config/codestreak/keys (never inside the repo).
set -euo pipefail

KEY_DIR="${CODESTREAK_KEY_DIR:-$HOME/.config/codestreak/keys}"
URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_ID="A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
AUTHORITY="$KEY_DIR/upgrade-authority.json"
PROGRAM_KEYPAIR="target/deploy/codestreak-keypair.json"
BACKUP_PROGRAM_KEYPAIR="$KEY_DIR/program-keypair.json"
SO="target/deploy/codestreak.so"
IDL="target/idl/codestreak.json"
SKIP_BUILD=0
VERIFIABLE=1

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --quick) VERIFIABLE=0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$1"; }
fail() { echo "ERROR: $1" >&2; exit 1; }

[[ -f Anchor.toml ]] || fail "run this from the repo root (cd /mnt/c/dev/CodeStreak)"
[[ -f "$AUTHORITY" ]] || fail "upgrade-authority key not found at $AUTHORITY (run scripts/wsl/generate-keys.sh)"

step "Cluster"
case "$URL" in *mainnet*) fail "refusing a mainnet URL" ;; esac
genesis="$(solana genesis-hash --url "$URL")"
[[ "$genesis" == "$DEVNET_GENESIS" ]] || fail "$URL is not devnet (genesis $genesis)"
echo "devnet OK ($URL)"

step "Program keypair"
if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  [[ -f "$BACKUP_PROGRAM_KEYPAIR" ]] || fail "missing $PROGRAM_KEYPAIR and no backup at $BACKUP_PROGRAM_KEYPAIR"
  mkdir -p target/deploy
  cp "$BACKUP_PROGRAM_KEYPAIR" "$PROGRAM_KEYPAIR"
  echo "restored from $BACKUP_PROGRAM_KEYPAIR"
fi
actual_id="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
[[ "$actual_id" == "$PROGRAM_ID" ]] || fail "program keypair is $actual_id, expected $PROGRAM_ID"
echo "program ID $PROGRAM_ID"

if [[ $SKIP_BUILD -eq 0 ]]; then
  if [[ $VERIFIABLE -eq 1 ]]; then
    command -v solana-verify >/dev/null 2>&1 || fail "solana-verify not found: cargo install solana-verify --git https://github.com/solana-foundation/solana-verifiable-build --rev 64a7fd490b4ea8f8c203d3268c24760529b17208 --locked (or use --quick)"
    docker info >/dev/null 2>&1 || fail "Docker is not running (start Docker Desktop with WSL integration), or use --quick"
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "uncommitted changes: a verifiable build must come from a commit (commit first, or use --quick)"
  fi
  step "anchor build (IDL + tests binary)"
  anchor build
  if [[ $VERIFIABLE -eq 1 ]]; then
    step "Verifiable build (solana-verify, Docker)"
    # Replaces target/deploy/codestreak.so with the reproducible build that gets deployed.
    solana-verify build --library-name codestreak
    echo "executable hash: $(solana-verify get-executable-hash "$SO")"
  fi
fi
[[ -f "$SO" ]] || fail "$SO not found (run without --skip-build)"
grep -aq "=======BEGIN SECURITY.TXT V1=======" "$SO" || fail "$SO has no security.txt (Phase 47): rebuild from the current source"

step "Funds"
authority_pk="$(solana-keygen pubkey "$AUTHORITY")"
so_bytes="$(stat -c %s "$SO")"
# Deploys write through a temporary buffer as large as the program, so about 2x the program's rent
# is needed while deploying (the buffer's share is returned afterwards).
rent="$(solana rent "$so_bytes" --url "$URL" | awk '/Rent-exempt minimum/ {print $3}')"
needed="$(awk -v r="$rent" 'BEGIN { printf "%.2f", r * 2 + 0.1 }')"
balance="$(solana balance "$authority_pk" --url "$URL" | awk '{print $1}')"
echo "program size $so_bytes bytes, rent $rent SOL; upgrade authority $authority_pk has $balance SOL, needs ~$needed SOL"
if awk -v b="$balance" -v n="$needed" 'BEGIN { exit !(b + 0 < n + 0) }'; then
  echo "Not enough devnet SOL. Options:" >&2
  echo "  - bash scripts/wsl/fund-devnet.sh   (airdrops, rate-limited)" >&2
  echo "  - https://faucet.solana.com  (sign in with GitHub) -> send to $authority_pk" >&2
  exit 1
fi

step "Deploy"
if solana program show "$PROGRAM_ID" --url "$URL" >/dev/null 2>&1; then
  echo "program exists: upgrading"
  # A bigger build needs a bigger ProgramData account first (Phase 34 added ~55 KB). Newer CLIs
  # extend automatically; doing it here explicitly works with older ones too.
  current="$(solana program show "$PROGRAM_ID" --url "$URL" | awk '/Data Length/ {print $3}')"
  if [[ -n "$current" && "$so_bytes" -gt "$current" ]]; then
    extra=$(( so_bytes - current + 10240 ))
    echo "program grows from $current to $so_bytes bytes: extending ProgramData by $extra bytes"
    solana program extend "$PROGRAM_ID" "$extra" --keypair "$AUTHORITY" --url "$URL"
  fi
else
  echo "first deploy"
fi
solana program deploy "$SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$AUTHORITY" \
  --keypair "$AUTHORITY" \
  --url "$URL"
solana program show "$PROGRAM_ID" --url "$URL"

step "IDL (on-chain, Program Metadata)"
# Lets explorers and `anchor idl fetch` read the interface. Not required by the app, which ships
# the IDL in packages/shared, so a failure here is reported but does not undo the deploy.
# Written with the Program Metadata CLI directly (pinned): it creates or resizes the account and
# retries the public devnet RPC's rate limits (HTTP 429), which made Anchor's bundled upload fail.
PMP_CLI="@solana-program/program-metadata@0.11.0"
idl_cmd=(npx --yes "$PMP_CLI" write idl "$PROGRAM_ID" "$IDL" --keypair "$AUTHORITY" --rpc "$URL")
onchain_idl="$(mktemp)"
anchor idl fetch "$PROGRAM_ID" --provider.cluster "$URL" -o "$onchain_idl" >/dev/null 2>&1 || : > "$onchain_idl"
# Same interface as on-chain (most upgrades don't change it): nothing to write.
if [[ -s "$onchain_idl" ]] && node -e '
  const fs = require("fs");
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  const [a, b] = process.argv.slice(1).map((f) => JSON.stringify(sort(JSON.parse(fs.readFileSync(f, "utf8")))));
  process.exit(a === b ? 0 : 1);' "$onchain_idl" "$IDL"; then
  echo "IDL on-chain is already up to date"
elif "${idl_cmd[@]}"; then
  echo "IDL uploaded"
else
  echo "WARNING: IDL upload failed (the program itself is deployed). Retry later with:" >&2
  echo "  ${idl_cmd[*]}" >&2
fi
rm -f "$onchain_idl"

if [[ $VERIFIABLE -eq 1 && $SKIP_BUILD -eq 0 ]]; then
  step "Verified build (Phase 47)"
  if git fetch --quiet origin && [[ -n "$(git branch -r --contains HEAD)" ]]; then
    bash scripts/wsl/verify-devnet.sh || echo "WARNING: verification did not finish (the program is deployed). Retry: bash scripts/wsl/verify-devnet.sh" >&2
  else
    echo "This commit is not on GitHub yet: git push, then run: bash scripts/wsl/verify-devnet.sh"
  fi
fi

step "Done"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "Next (Windows PowerShell, repo root):"
echo "  pnpm devnet:init-config   # once: admin, verifier, allowed mints"
echo "  pnpm devnet:seed-demo     # creates and reads a labeled demo challenge"
echo "  pnpm devnet:set-entry-gate  # once (Phase 37.2): only the relayer may approve create/join/sponsor"
