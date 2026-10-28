#!/usr/bin/env bash
# Project-specific additions to scripts/test-package.sh (sourced with $consumer set to the install
# prefix of the packed tarball). The canonical script already checked --help and the --version line
# of every bin; this adds what is specific to flashlink:
#   - the tarball ships the CLI's dist/ and the build stamp (npm would run `fl` without a commit);
#   - `fl` works from a clean environment: default config, no checkout, no wrangler, no network;
#   - `fl update --check` answers 0 (current), 1 (update available) or 2 (unknown), never crashes.
set -euo pipefail

fl="$consumer/node_modules/.bin/fl"

# The published package is the repository root; the CLI itself is built into packages/cli/dist.
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const root = process.argv[1];
  for (const file of ["packages/cli/dist/index.js", "dist/build-info.json"]) {
    if (!fs.existsSync(path.join(root, file))) {
      console.error(`Error: the tarball does not ship ${file}.`);
      process.exit(1);
    }
  }
  const info = JSON.parse(fs.readFileSync(path.join(root, "dist/build-info.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (info.version !== pkg.version || !/^[0-9a-f]{40}$/.test(info.commit ?? "")) {
    console.error("Error: dist/build-info.json has no commit stamp for this version.");
    process.exit(1);
  }
' "$consumer/node_modules/flashlink"

# A user's machine has no checkout and no FLASHLINK_* variables: the defaults must still answer.
home="$tmpdir/home"
mkdir -p "$home"
endpoint=$(
  env -i HOME="$home" PATH=/usr/bin:/bin:/usr/local/bin \
    XDG_CONFIG_HOME="$home/.config" XDG_DATA_HOME="$home/.local/share" \
    "$(command -v node)" "$fl" config get endpoint
)
[[ -n "$endpoint" ]] || { echo 'Error: `fl config get endpoint` printed nothing.' >&2; exit 1; }

# `update --check` reports; it must never fail for another reason than "1: update available".
set +e
env -i HOME="$home" PATH=/usr/bin:/bin:/usr/local/bin \
  XDG_CONFIG_HOME="$home/.config" XDG_DATA_HOME="$home/.local/share" \
  "$(command -v node)" "$fl" update --check >/dev/null 2>&1
status=$?
set -e
case $status in
  0 | 1 | 2) ;;
  *)
    echo "Error: 'fl update --check' exited $status; expected 0, 1 or 2." >&2
    exit 1
    ;;
esac
