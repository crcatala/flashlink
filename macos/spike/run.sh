#!/bin/sh
# Build the Finder Sync spike with LOCAL signing only, install it to ~/Applications, enable the
# extension and restart Finder. Run on a Mac, from anywhere:
#
#   sh macos/spike/run.sh                 # ad hoc signing ("Sign to Run Locally"), watches "/"
#   WATCH=home sh macos/spike/run.sh      # watch the home folder + mounted volumes instead of "/"
#   SIGNING=team TEAM=ABCDE12345 sh macos/spike/run.sh   # fallback: free personal Apple ID team
#   sh macos/spike/run.sh --uninstall     # remove it again
#
# Needs Xcode (not just the command line tools) and XcodeGen (`brew install xcodegen`).
# Nothing signing-related is stored in the repo; a team id only ever comes from your environment.

set -eu
cd "$(dirname "$0")"

APP_NAME="r2-fastlink.app"
DEST="$HOME/Applications"
APP_ID="dev.r2fastlink.spike"
EXT_ID="dev.r2fastlink.spike.FinderSync"
APPEX="$DEST/$APP_NAME/Contents/PlugIns/R2FLFinderSync.appex"

[ "$(uname -s)" = Darwin ] || { echo "This spike builds and runs on macOS only."; exit 1; }

remove_installed() {
  [ ! -d "$APPEX" ] || pluginkit -r "$APPEX" 2>/dev/null || true
  pluginkit -e ignore -i "$EXT_ID" 2>/dev/null || true
  killall r2-fastlink 2>/dev/null || true
  rm -rf "$DEST/$APP_NAME"
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_installed
  killall Finder 2>/dev/null || true
  echo "Removed $DEST/$APP_NAME and restarted Finder."
  exit 0
fi

command -v xcodegen >/dev/null || { echo "XcodeGen is missing: brew install xcodegen"; exit 1; }
command -v xcodebuild >/dev/null || { echo "xcodebuild is missing: install Xcode"; exit 1; }
xcodebuild -version >/dev/null 2>&1 || { echo "Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }

conditions='$(inherited)'
case "${WATCH:-root}" in
  root) ;;
  home) conditions="$conditions WATCH_HOME" ;;
  *) echo "WATCH must be 'root' or 'home'"; exit 1 ;;
esac

signing="ad hoc (Sign to Run Locally)"
set -- "$@" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=
if [ "${SIGNING:-adhoc}" = team ]; then
  [ -n "${TEAM:-}" ] || { echo "SIGNING=team needs TEAM=<your personal team id> (Xcode > Settings > Accounts)"; exit 1; }
  signing="personal team $TEAM (Apple Development)"
  set -- -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic "CODE_SIGN_IDENTITY=Apple Development" "DEVELOPMENT_TEAM=$TEAM"
fi

echo "== macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)), $(xcodebuild -version | tr '\n' ' ')"
echo "== signing: $signing; watching: ${WATCH:-root}"

xcodegen generate --quiet
xcodebuild -project R2FLSpike.xcodeproj -scheme R2FLSpike -configuration Debug \
  -derivedDataPath build "SWIFT_ACTIVE_COMPILATION_CONDITIONS=$conditions" "$@" build \
  | tail -n 25
built="build/Build/Products/Debug/$APP_NAME"
[ -d "$built" ] || { echo "Build did not produce $built"; exit 1; }

remove_installed
mkdir -p "$DEST"
ditto "$built" "$DEST/$APP_NAME"

echo "== signature of what was installed"
codesign -dvv "$DEST/$APP_NAME" 2>&1 | grep -E "Identifier|Signature|TeamIdentifier|Authority" || true
codesign -d --entitlements - "$APPEX" 2>&1 | grep -E "app-sandbox|user-selected" || echo "(no entitlements printed for the extension)"

open "$DEST/$APP_NAME"     # registers the r2fl-spike:// scheme and asks for notification permission
sleep 2
pluginkit -a "$APPEX"
pluginkit -e use -i "$EXT_ID"
killall Finder 2>/dev/null || true

echo "== extension registration (a leading '+' means enabled)"
pluginkit -m -v -i "$EXT_ID" || true
cat <<MSG

Next:
  1. Allow notifications for r2-fastlink if macOS asks.
  2. If the menu does not show up, enable the extension by hand: System Settings > General >
     Login Items & Extensions > Extensions ("Added Extensions" / by category: Finder), or on older
     macOS: Privacy & Security > Extensions > Added Extensions. Then run: killall Finder
  3. Right-click a file in Finder: "Share via r2-fastlink" with 15 minutes / 1 hour / 1 day / 7 days.
  4. Watch what happens:  tail -f ~/Library/Logs/r2fl-spike.log
     Extension logs:      log stream --predicate 'subsystem == "$APP_ID"' --level info
  5. Test the second half of the pipeline without Finder: sh macos/spike/test-handoff.sh
MSG
