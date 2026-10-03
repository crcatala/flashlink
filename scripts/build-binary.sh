#!/bin/sh
# Compile the r2fl CLI into standalone executables (the Bun runtime and the bundled CLI in one
# file), so the macOS Quick Action does not depend on the user's node, PATH or version manager.
#
#   scripts/build-binary.sh                  # darwin-arm64 and darwin-x64
#   scripts/build-binary.sh darwin-arm64     # one target (also: darwin-x64, linux-x64, linux-arm64)
#
# Output: dist/bin/r2fl-<target>. Needs Bun (https://bun.sh). Bun cross-compiles, so this works on
# Linux too. A binary built here is NOT signed: macos/install.sh ad hoc signs it on the Mac.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "build-binary.sh: bun not found. Install it from https://bun.sh" >&2
  exit 1
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
    --outfile "$out/r2fl-$target"
  echo "built: dist/bin/r2fl-$target"
done
