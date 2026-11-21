#!/usr/bin/env bash
# Tops up CodeStreak operator keys with DEVNET SOL (no real value).
#
# Usage (WSL Ubuntu):
#   bash scripts/wsl/fund-devnet.sh                    # fund the four operator keys up to their targets
#   bash scripts/wsl/fund-devnet.sh --wallet <PUBKEY>  # also fund a wallet, e.g. your MetaMask Solana address
#
# The devnet faucet is rate-limited. When an airdrop is refused, the script
# prints the web faucet link (https://faucet.solana.com, sign in with GitHub
# for higher limits) and moves on.
set -uo pipefail

KEY_DIR="${CODESTREAK_KEY_DIR:-$HOME/.config/codestreak/keys}"
URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
case "$URL" in *mainnet*) echo "Refusing to run against a mainnet URL." >&2; exit 1 ;; esac

# name:target_SOL
TARGETS=("upgrade-authority:8" "relayer:2" "verifier:0.5" "admin:0.5")
EXTRA_WALLET=""
EXTRA_TARGET=2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wallet) EXTRA_WALLET="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

balance_of() {
  solana balance "$1" --url "$URL" 2>/dev/null | awk '{print $1}'
}

below() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a + 0 < b + 0) }'; }

fund() {
  local label="$1" pk="$2" target="$3"
  local bal attempt=0
  bal="$(balance_of "$pk")"; bal="${bal:-0}"
  echo "$label ($pk): $bal SOL (target $target)"
  while below "$bal" "$target" && [[ $attempt -lt 4 ]]; do
    attempt=$((attempt + 1))
    if solana airdrop 2 "$pk" --url "$URL" >/dev/null 2>&1; then
      sleep 2
      bal="$(balance_of "$pk")"; bal="${bal:-0}"
      echo "  airdrop ok -> $bal SOL"
    else
      echo "  airdrop refused (rate limit). Waiting $((attempt * 10))s..."
      sleep $((attempt * 10))
    fi
  done
  if below "$bal" "$target"; then
    echo "  still below target. Use the web faucet: https://faucet.solana.com  (address: $pk)"
    return 1
  fi
  return 0
}

missing=0
for entry in "${TARGETS[@]}"; do
  name="${entry%%:*}"; target="${entry##*:}"
  file="$KEY_DIR/$name.json"
  if [[ ! -f "$file" ]]; then
    echo "$name: keypair missing. Run: bash scripts/wsl/generate-keys.sh" >&2
    missing=$((missing + 1)); continue
  fi
  fund "$name" "$(solana-keygen pubkey "$file")" "$target" || missing=$((missing + 1))
done

if [[ -n "$EXTRA_WALLET" ]]; then
  fund "wallet" "$EXTRA_WALLET" "$EXTRA_TARGET" || missing=$((missing + 1))
fi

echo
echo "Devnet USDC: get it from https://faucet.circle.com (network: Solana Devnet)"
echo "for your MetaMask Solana address and any test wallets."
exit $(( missing > 0 ? 1 : 0 ))
