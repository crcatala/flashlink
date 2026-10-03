#!/bin/sh
# Build the Finder Sync spike with LOCAL signing only, install it to ~/Applications, enable the
# extension and restart Finder. Needs Xcode and XcodeGen. Without Xcode, download the build from CI
# and use install.sh instead (see README.md). Options are passed through to build.sh:
#
#   sh macos/spike/run.sh                 # ad hoc signing ("Sign to Run Locally"), watches "/"
#   WATCH=home sh macos/spike/run.sh      # watch the home folder + mounted volumes instead of "/"
#   SIGNING=team TEAM=ABCDE12345 sh macos/spike/run.sh   # fallback: free personal Apple ID team
#   sh macos/spike/run.sh --uninstall     # remove it again

set -eu
cd "$(dirname "$0")"

if [ "${1:-}" = "--uninstall" ]; then exec sh install.sh --uninstall; fi

app=$(sh build.sh "$@") # build.sh prints only the app path on stdout; a failed build stops here
exec sh install.sh "$app"
