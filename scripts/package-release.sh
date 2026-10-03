#!/bin/sh
# Build everything a GitHub Release carries, into one folder (default dist/release):
#
#   r2fl-darwin-arm64, r2fl-darwin-x64   standalone binaries (scripts/build-binary.sh)
#   r2fl-macos-support.tar.gz            the macos/ folder (Quick Actions, wrapper, notifier source)
#   install.sh, uninstall.sh             copies of macos/install.sh and macos/uninstall.sh, so one
#                                        curl command can run them without a checkout
#   SHA256SUMS                           checksums of all of the above
#
#   scripts/package-release.sh [OUTDIR]
#
# Used by the release workflow and, to catch a broken build early, by CI on every pull request.
# Needs Bun and `pnpm install` (see build-binary.sh). Runs on Linux or macOS.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$root/dist/release}

rm -rf "$out"
mkdir -p "$out"

sh "$root/scripts/build-binary.sh" darwin-arm64 darwin-x64
for target in darwin-arm64 darwin-x64; do
  cp "$root/dist/bin/r2fl-$target" "$out/r2fl-$target"
done

# The archive holds the macos/ folder as it is checked in.
tar -czf "$out/r2fl-macos-support.tar.gz" -C "$root" macos
cp "$root/macos/install.sh" "$root/macos/uninstall.sh" "$out/"

(
  cd "$out"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum r2fl-darwin-arm64 r2fl-darwin-x64 r2fl-macos-support.tar.gz install.sh uninstall.sh
  else
    shasum -a 256 r2fl-darwin-arm64 r2fl-darwin-x64 r2fl-macos-support.tar.gz install.sh uninstall.sh
  fi >SHA256SUMS
)

echo "release files in $out:"
ls -l "$out"
