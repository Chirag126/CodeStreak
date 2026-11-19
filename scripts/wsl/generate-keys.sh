#!/usr/bin/env bash
# Generates the four CodeStreak operator keypairs OUTSIDE the repository.
#
#   upgrade-authority  deploys / upgrades the Anchor program (stays on this machine)
#   relayer            pays transaction fees, co-signs allowed transactions (web service)
#   verifier           signs daily verification results (worker service only)
#   admin              program config admin (mint allowlist, default verifier)
#
# Usage (WSL Ubuntu):
#   bash scripts/wsl/generate-keys.sh                # create missing keys, print public keys
#   bash scripts/wsl/generate-keys.sh --set-default  # also point the Solana CLI at devnet + upgrade-authority
#
# Existing keys are never overwritten.
set -euo pipefail

KEY_DIR="${CODESTREAK_KEY_DIR:-$HOME/.config/codestreak/keys}"
NAMES=(upgrade-authority relayer verifier admin)

if ! command -v solana-keygen >/dev/null 2>&1; then
  echo "solana-keygen not found. Install the Solana toolchain first (see the Phase 1 PR description)." >&2
  exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

for name in "${NAMES[@]}"; do
  file="$KEY_DIR/$name.json"
  if [[ -f "$file" ]]; then
    echo "exists   $name -> $file"
  else
    # --silent: do not print the seed phrase. Back up the JSON file itself instead.
    solana-keygen new --no-bip39-passphrase --silent --outfile "$file" >/dev/null
    echo "created  $name -> $file"
  fi
  chmod 600 "$file"
done

out="$KEY_DIR/pubkeys.env"
{
  echo "# CodeStreak operator PUBLIC keys. Safe to copy into .env.local."
  echo "UPGRADE_AUTHORITY_PUBKEY=$(solana-keygen pubkey "$KEY_DIR/upgrade-authority.json")"
  echo "RELAYER_PUBKEY=$(solana-keygen pubkey "$KEY_DIR/relayer.json")"
  echo "VERIFIER_PUBKEY=$(solana-keygen pubkey "$KEY_DIR/verifier.json")"
  echo "ADMIN_PUBKEY=$(solana-keygen pubkey "$KEY_DIR/admin.json")"
} > "$out"

echo
cat "$out"
echo
echo "Saved to $out"

if [[ "${1:-}" == "--set-default" ]]; then
  solana config set --url devnet --keypair "$KEY_DIR/upgrade-authority.json"
fi

echo
echo "Back up $KEY_DIR somewhere private. Never copy these JSON files into the repo."
