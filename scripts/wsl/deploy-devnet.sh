#!/usr/bin/env bash
# Builds and deploys (or upgrades) the CodeStreak program on Solana DEVNET, then uploads its IDL.
#
# Usage (WSL Ubuntu, from the repo root):
#   bash scripts/wsl/deploy-devnet.sh               # build + deploy/upgrade + IDL
#   bash scripts/wsl/deploy-devnet.sh --skip-build  # deploy the existing target/deploy/codestreak.so
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

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
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
  step "anchor build"
  anchor build
fi
[[ -f "$SO" ]] || fail "$SO not found (run without --skip-build)"

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
if anchor idl fetch "$PROGRAM_ID" --provider.cluster "$URL" >/dev/null 2>&1; then
  idl_cmd=(anchor idl upgrade -f "$IDL" "$PROGRAM_ID")
else
  idl_cmd=(anchor idl init -f "$IDL" "$PROGRAM_ID")
fi
if "${idl_cmd[@]}" --provider.cluster "$URL" --provider.wallet "$AUTHORITY"; then
  echo "IDL uploaded"
else
  echo "WARNING: IDL upload failed (the program itself is deployed). Retry later with:" >&2
  echo "  ${idl_cmd[*]} --provider.cluster $URL --provider.wallet $AUTHORITY" >&2
fi

step "Done"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "Next (Windows PowerShell, repo root):"
echo "  pnpm devnet:init-config   # once: admin, verifier, allowed mints"
echo "  pnpm devnet:seed-demo     # creates and reads a labeled demo challenge"
