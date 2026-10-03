#!/bin/sh
# Generate the Xcode project and build the spike with LOCAL signing only. Needs Xcode and XcodeGen.
# Prints the path of the built r2-fastlink.app as the last line. Used by run.sh and by CI.
#
#   sh macos/spike/build.sh                 # ad hoc signing ("Sign to Run Locally"), watches "/"
#   WATCH=home sh macos/spike/build.sh      # watch the home folder + mounted volumes instead
#   SIGNING=team TEAM=ABCDE12345 sh macos/spike/build.sh   # fallback: free personal Apple ID team
#
# Nothing signing-related is stored in the repo; a team id only ever comes from your environment.

set -eu
cd "$(dirname "$0")"

[ "$(uname -s)" = Darwin ] || { echo "This spike builds on macOS only." >&2; exit 1; }
command -v xcodegen >/dev/null || { echo "XcodeGen is missing: brew install xcodegen" >&2; exit 1; }
command -v xcodebuild >/dev/null || { echo "xcodebuild is missing: install Xcode" >&2; exit 1; }
xcodebuild -version >/dev/null 2>&1 || {
  echo "Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
}

conditions='$(inherited)'
case "${WATCH:-root}" in
  root) ;;
  home) conditions="$conditions WATCH_HOME" ;;
  *) echo "WATCH must be 'root' or 'home'" >&2; exit 1 ;;
esac

signing="ad hoc (Sign to Run Locally)"
set -- "$@" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=
if [ "${SIGNING:-adhoc}" = team ]; then
  [ -n "${TEAM:-}" ] || { echo "SIGNING=team needs TEAM=<your personal team id> (Xcode > Settings > Accounts)" >&2; exit 1; }
  signing="personal team $TEAM (Apple Development)"
  set -- -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic "CODE_SIGN_IDENTITY=Apple Development" "DEVELOPMENT_TEAM=$TEAM"
fi

{
  echo "== macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)), $(xcodebuild -version | tr '\n' ' ')"
  echo "== signing: $signing; watching: ${WATCH:-root}"
  xcodegen generate --quiet
  xcodebuild -project R2FLSpike.xcodeproj -scheme R2FLSpike -configuration Debug \
    -derivedDataPath build "SWIFT_ACTIVE_COMPILATION_CONDITIONS=$conditions" "$@" build \
    | tail -n 25
} >&2
built="$PWD/build/Build/Products/Debug/r2-fastlink.app"
[ -d "$built" ] || { echo "Build did not produce $built" >&2; exit 1; }
echo "$built"
