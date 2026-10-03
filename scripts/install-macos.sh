#!/bin/sh
# Build the standalone r2fl for this Mac and install the Finder Quick Actions with it:
# scripts/build-binary.sh for this machine's architecture, then macos/install.sh --binary.
# Needs Bun and `pnpm install` once. Run it again after pulling to refresh everything.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-macos.sh: this installs the Finder Quick Actions, which are macOS only." >&2
  exit 1
fi

case $(uname -m) in
  arm64) target=darwin-arm64 ;;
  x86_64) target=darwin-x64 ;;
  *)
    echo "install-macos.sh: unsupported architecture $(uname -m)" >&2
    exit 1
    ;;
esac

sh "$root/scripts/build-binary.sh" "$target"
sh "$root/macos/install.sh" --binary "$root/dist/bin/r2fl-$target"
