#!/bin/sh
# Guided manual QA for the Finder Quick Actions. Run from the repo root, in Terminal, on a Mac:
#
#   sh macos/qa.sh 2>&1 | tee ~/flashlink-qa.log
#
# It runs the installed wrapper in a bare environment (what Finder gives it), so you do not have to
# click through Finder for every case. For each step it says what you should SEE (a dialog, a
# notification); the file contents of the links are checked for you. It uploads a few tiny files
# that expire within an hour. At the end, paste ~/flashlink-qa.log and note any step that looked wrong.

set -u

wrapper="$HOME/.local/bin/fl-quick"
files="$HOME/flashlink-qa-files"
fails=0

bare() { env -i HOME="$HOME" USER="${USER:-}" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$@"; }
step() { printf '\n=== %s\n    EXPECT: %s\n' "$1" "$2"; }
pause() { printf '    [Enter when you have looked] '; read -r _; }
pass() { printf '    PASS: %s\n' "$1"; }
fail() { printf '    FAIL: %s\n' "$1"; fails=$((fails + 1)); }

# Fetch every URL on the clipboard and compare with the expected contents, in order.
check_links() {
  n=0
  for expected in "$@"; do
    n=$((n + 1))
    url=$(pbpaste | sed -n "${n}p")
    got=$(curl -fsS "$url" 2>&1)
    if [ "$got" = "$expected" ]; then pass "link $n serves \"$expected\" ($url)"; else fail "link $n ($url) gave: $got"; fi
  done
}

if [ "$(uname -s)" != "Darwin" ]; then echo "This QA runs on macOS only."; exit 1; fi
[ -f macos/install.sh ] || { echo "Run this from the repo root."; exit 1; }

step "0. Versions and plist check" "four 'OK' lines from plutil"
sw_vers
echo "zsh: $(/bin/zsh --version)"
plutil -lint macos/*.workflow/Contents/Info.plist macos/*.workflow/Contents/document.wflow

step "1. Setup" "fl found in this Terminal; a hand-made ~/.local/bin/fl symlink is removed so the recorded path is what gets tested"
if [ -L "$HOME/.local/bin/fl" ]; then rm "$HOME/.local/bin/fl"; echo "removed old symlink ~/.local/bin/fl"; fi
command -v fl node || { echo "fl or node not found in this Terminal: fix that first."; exit 1; }
fl --version
orig_ttl=$(fl config get defaultTtl)
mkdir -p "$files" && cd "$files" || exit 1
printf 'hello' >one.txt
printf 'two' >two.txt
printf 'quoted' >"it's a \"test\" café.txt"
printf 'dash' >-dashfile.txt
mkfile 60m big.bin
cd - >/dev/null || exit 1

step "2. Install" "'recorded: ...', then 'fl and node are found the way a Quick Action will look for them.' and NO warning"
sh macos/install.sh
step "2b. Wrapper check in a bare environment" "two paths (fl and node), exit 0"
if bare "$wrapper" --check; then pass "found"; else fail "--check failed"; fi

step "3. One file with the lifetime picker" "a 'Link lifetime' dialog IN FRONT of other windows with '1 hour' highlighted: press OK/Return. Then a notification with the link."
bare "$wrapper" "$files/one.txt"
echo "    exit=$?"
pause
check_links hello

step "4. Cancel in the picker" "same dialog: click Cancel. Nothing happens: no notification, no new link."
before=$(fl ls --all | wc -l)
bare "$wrapper" "$files/one.txt"
echo "    exit=$? (expect 0)"
after=$(fl ls --all | wc -l)
if [ "$before" = "$after" ]; then pass "no new history entry"; else fail "history changed ($before -> $after)"; fi

step "5. A 45m default" "the list shows '45m' as an extra item and it is HIGHLIGHTED. Choose '15 minutes'."
fl config set defaultTtl 45m
bare "$wrapper" "$files/one.txt"
pause
fl config set defaultTtl "$orig_ttl"
echo "    newest link (expect about 15 minutes from now):"
fl ls -n 1

step "6. Default-lifetime variant, several awkward file names" "NO dialog. One notification covering 4 links."
bare "$wrapper" --no-prompt "$files/one.txt" "$files/two.txt" "$files/it's a \"test\" café.txt" "$files/-dashfile.txt"
echo "    exit=$? (expect 0)"
pause
check_links hello two quoted dash

step "7. File over the 50 MB cap" "an error notification mentioning the size; no link"
bare "$wrapper" --no-prompt "$files/big.bin"
echo "    exit=$? (expect 1)"
pause

step "8. Wrong token" "an error notification about the token"
bare FLASHLINK_TOKEN=wrongwrongwrong "$wrapper" --no-prompt "$files/one.txt"
echo "    exit=$? (expect 1)"
pause

step "9. Offline" "an error notification (cannot reach the server)"
bare FLASHLINK_ENDPOINT=http://127.0.0.1:9 "$wrapper" --no-prompt "$files/one.txt"
echo "    exit=$? (expect 1)"
pause

step "10. Stale record, then recovery" "with a bogus recorded folder the interactive retry still finds fl (via ~/.zshrc); if not, you get the 'Run macos/install.sh again' hint"
cp "$HOME/.config/flashlink/quick-action-path" "$HOME/.config/flashlink/quick-action-path.bak"
echo /nonexistent >"$HOME/.config/flashlink/quick-action-path"
bare "$wrapper" --check && pass "found via the interactive retry" || echo "    NOTE: not found without the record (acceptable only if ~/.zshrc does not set PATH)"
mv "$HOME/.config/flashlink/quick-action-path.bak" "$HOME/.config/flashlink/quick-action-path"

step "11. Finder wiring (do this by hand)" "enable both actions in System Settings -> Keyboard -> Keyboard Shortcuts -> Services -> Files and Folders; right-click ~/flashlink-qa-files/one.txt -> Quick Actions -> 'Share via flashlink' shows the picker IN FRONT of Finder; then 'Share via flashlink (default lifetime)' uploads with no dialog"
pause

step "12. Uninstall" "all three paths below are gone"
sh macos/uninstall.sh
for leftover in "$HOME/Library/Services/Share via flashlink.workflow" \
  "$HOME/Library/Services/Share via flashlink (default lifetime).workflow" \
  "$wrapper" "$HOME/.config/flashlink/quick-action-path"; do
  if [ -e "$leftover" ]; then fail "still there: $leftover"; else pass "gone: $leftover"; fi
done
printf '    Reinstall now so the actions stay available? [y/N] '
read -r answer
case $answer in y | Y) sh macos/install.sh ;; esac

rm -rf "$files"
printf '\n=== Done. Automatic checks failed: %s\n' "$fails"
echo "Now paste ~/flashlink-qa.log and tell me which EXPECT lines did not match what you saw."
