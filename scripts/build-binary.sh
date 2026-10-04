#!/bin/sh
# Compile the fl CLI into standalone executables (the Bun runtime and the bundled CLI in one
# file), so the macOS Quick Action does not depend on the user's node, PATH or version manager.
#
#   scripts/build-binary.sh                  # darwin-arm64 and darwin-x64
#   scripts/build-binary.sh darwin-arm64     # one target (also: darwin-x64, linux-x64, linux-arm64)
#
# Output: dist/bin/flashlink-<target>. Needs Bun (https://bun.sh). Bun cross-compiles, so this works on
# Linux too. A binary built here is NOT signed: macos/install.sh ad hoc signs it on the Mac.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/bin"

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Bun is needed to build the standalone fl binary, but `bun` was not found.

Why: a Finder Quick Action starts with a bare PATH, so it cannot rely on your node. Bun compiles
the CLI into one self-contained file (about 60 MB) that needs neither node nor PATH. It is only
used to BUILD that file; running it does not need Bun.

To continue, install Bun and run this again:
  brew install oven-sh/bun/bun        (or see https://bun.sh)

Prefer not to install Bun? The Quick Actions also work with your own fl and node (they are
looked up in your login shell); nothing is built:
  sh macos/install.sh
MSG
  exit 1
fi

# The bundler resolves the CLI's dependencies from node_modules.
if [ ! -d "$root/packages/cli/node_modules/commander" ]; then
  cat >&2 <<'MSG'
The CLI's dependencies are not installed yet, so the binary cannot be built.
Run this once from the repository root, then try again:
  pnpm install
MSG
  exit 1
fi

# The git commit goes into `fl --version` (and the Quick Action's lifetime dialog), so you can
# tell which build is installed. "-dirty" marks uncommitted changes.
build_id=$(git -C "$root" rev-parse --short HEAD 2>/dev/null || true)
if [ -n "$build_id" ] && [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then
  build_id="$build_id-dirty"
fi

[ "$#" -gt 0 ] || set -- darwin-arm64 darwin-x64
mkdir -p "$out"

for target in "$@"; do
  case $target in
    darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64) ;;
    *)
      echo "build-binary.sh: unknown target '$target'" >&2
      exit 2
      ;;
  esac
  bun build --compile "--target=bun-$target" "$root/packages/cli/src/index.ts" \
    --define "__FLASHLINK_BUILD__=\"${build_id:-unknown}\"" --outfile "$out/flashlink-$target"
  echo "built: dist/bin/flashlink-$target"
done
