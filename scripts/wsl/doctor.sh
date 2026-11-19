#!/usr/bin/env bash
# CodeStreak WSL environment check: Rust, Solana CLI, Anchor, devnet config, operator keys.
# Usage (WSL Ubuntu, from the repo root):  bash scripts/wsl/doctor.sh
set -uo pipefail

KEY_DIR="${CODESTREAK_KEY_DIR:-$HOME/.config/codestreak/keys}"
fail=0
warns=0

ok()   { printf '\033[32m[OK  ]\033[0m %-24s %s\n' "$1" "$2"; }
warn() { printf '\033[33m[WARN]\033[0m %-24s %s\n' "$1" "$2"; warns=$((warns + 1)); }
bad()  { printf '\033[31m[FAIL]\033[0m %-24s %s\n' "$1" "$2"; fail=$((fail + 1)); }

first_line() { "$@" 2>/dev/null | head -n1; }

echo "== Toolchain =="
for tool in rustc cargo solana solana-keygen avm anchor; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool" "$(first_line "$tool" --version)"
  else
    case "$tool" in
      avm) warn "$tool" "not found (optional, recommended for pinning Anchor)" ;;
      *)   bad "$tool" "not found. Run the Solana quick installer (see PR description)." ;;
    esac
  fi
done

if command -v anchor >/dev/null 2>&1; then
  major="$(anchor --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 | cut -d. -f1)"
  if [[ -n "$major" && "$major" -lt 1 ]]; then
    warn "anchor version" "pre-1.0 Anchor detected; run: avm install latest && avm use latest"
  fi
fi

# Anchor's TypeScript tests run inside WSL, so WSL needs its own Node.
if command -v node >/dev/null 2>&1; then
  ok "node (WSL)" "$(node --version)"
else
  bad "node (WSL)" "not found inside WSL (needed for Anchor TS tests)"
fi
if command -v yarn >/dev/null 2>&1 || command -v pnpm >/dev/null 2>&1; then
  ok "yarn/pnpm (WSL)" "$(first_line yarn --version || true) $(first_line pnpm --version || true)"
else
  warn "yarn/pnpm (WSL)" "neither found inside WSL"
fi

for pkg in build-essential pkg-config libudev-dev libssl-dev; do
  if dpkg -s "$pkg" >/dev/null 2>&1; then ok "apt:$pkg" "installed"; else warn "apt:$pkg" "missing: sudo apt-get install -y $pkg"; fi
done

echo
echo "== Solana CLI config =="
if command -v solana >/dev/null 2>&1; then
  rpc="$(solana config get 2>/dev/null | awk -F': ' '/RPC URL/ {print $2}' | sed 's/[[:space:]]*$//')"
  kp="$(solana config get 2>/dev/null | awk -F': ' '/Keypair Path/ {print $2}' | sed 's/[[:space:]]*$//')"
  case "$rpc" in
    *mainnet*) bad "cluster" "$rpc  ->  run: solana config set --url devnet" ;;
    *devnet*)  ok "cluster" "$rpc" ;;
    *)         warn "cluster" "$rpc (expected devnet: solana config set --url devnet)" ;;
  esac
  if [[ "$kp" == "$KEY_DIR/upgrade-authority.json" ]]; then
    ok "default keypair" "$kp"
  else
    warn "default keypair" "$kp  (deploys use upgrade-authority: bash scripts/wsl/generate-keys.sh --set-default)"
  fi
fi

echo
echo "== Operator keys ($KEY_DIR) =="
declare -A TARGET=( [upgrade-authority]=5 [relayer]=2 [verifier]=0.5 [admin]=0.5 )
declare -A SEEN=()
for name in upgrade-authority relayer verifier admin; do
  file="$KEY_DIR/$name.json"
  if [[ ! -f "$file" ]]; then
    bad "$name" "missing. Run: bash scripts/wsl/generate-keys.sh"
    continue
  fi
  perms="$(stat -c '%a' "$file")"
  [[ "$perms" == "600" ]] || warn "$name perms" "$perms (expected 600): chmod 600 $file"
  pk="$(solana-keygen pubkey "$file" 2>/dev/null)"
  if [[ -n "${SEEN[$pk]:-}" ]]; then bad "$name" "same key as ${SEEN[$pk]}"; fi
  SEEN[$pk]="$name"
  bal="$(solana balance "$pk" --url devnet 2>/dev/null | awk '{print $1}')"
  if [[ -z "$bal" ]]; then
    warn "$name" "$pk  (balance unavailable: devnet RPC unreachable?)"
  elif awk -v a="$bal" -v b="${TARGET[$name]}" 'BEGIN { exit !(a + 0 < b + 0) }'; then
    warn "$name" "$pk  $bal SOL (< ${TARGET[$name]}): bash scripts/wsl/fund-devnet.sh"
  else
    ok "$name" "$pk  $bal SOL"
  fi
done

echo
echo "== Repository =="
if [[ "$PWD" == /mnt/* ]]; then
  ok "location" "$PWD (Windows drive: works from PowerShell; Anchor builds are slower)"
else
  ok "location" "$PWD"
fi
if git rev-parse --git-dir >/dev/null 2>&1; then
  hp="$(git config --get core.hooksPath || true)"
  [[ "$hp" == ".githooks" ]] && ok "git hooks" ".githooks" || warn "git hooks" "not installed: git config core.hooksPath .githooks"
fi

echo
echo "$fail failure(s), $warns warning(s)"
exit $(( fail > 0 ? 1 : 0 ))
