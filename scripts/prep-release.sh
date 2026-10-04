#!/usr/bin/env bash
# Usage: pnpm release:prep [last-tag]
# Prints the commits since the last tag and a prompt for drafting the next CHANGELOG.md section.
# Paste everything from the "Changelog prompt" line down into an LLM, review the result, and put it
# under "## [Unreleased]" in CHANGELOG.md.
set -euo pipefail

last_tag="${1:-$(git describe --tags --match='v*' --abbrev=0 2>/dev/null || true)}"
if [[ -n "$last_tag" ]] && ! git rev-parse --verify --quiet "${last_tag}^{commit}" >/dev/null; then
  echo "Error: '$last_tag' is not a valid tag or commit." >&2
  exit 1
fi

range='HEAD'
[[ -n "$last_tag" ]] && range="${last_tag}..HEAD"

echo '=== Release Prep ==='
if [[ -n "$last_tag" ]]; then echo "Changes since: $last_tag"; else echo 'No prior tag; showing all commits.'; fi
echo

cat <<'PROMPT'
=== Changelog prompt (copy everything below this line) ===

Draft Keep a Changelog entries (https://keepachangelog.com/en/1.1.0/) from the commits below.
This project ships a CLI (`fl`), a Cloudflare Worker and a macOS Quick Action; write for the people
who use or deploy them. Commits use conventional prefixes: `feat` becomes Added or Changed, `fix`
becomes Fixed, and `!` or BREAKING marks a breaking change (put it first, say what to do). Group under
Added, Changed, Fixed, Removed or Security and omit empty groups. One line per user-visible change,
in plain words, no commit hashes or ticket ids. Leave out tests, CI, ticket bookkeeping, refactors and
docs-only commits unless they change what a user can do. Merge several commits about one thing.

=== Full commit messages ===
PROMPT

git log "$range" --format='## %s%n%n%b%n---' --no-merges | sed '/^Co-authored-by:/Id' | cat -s

echo -e '\n=== Changed files ==='
if [[ -n "$last_tag" ]]; then
  git diff --stat "$range"
else
  git diff --stat "$(git hash-object -t tree /dev/null)" HEAD
fi
