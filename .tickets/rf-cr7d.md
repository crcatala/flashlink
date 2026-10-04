---
id: rf-cr7d
status: closed
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, docs, needs-human, batch-10]
---
# Choose and add a license (owner decision)

## Why
The repo is meant to go public so others can fork and deploy it. README.md currently says "To be decided before the repo goes public." This needs the OWNER's decision (do not choose for them).

## Design

Present the owner with a short comparison (MIT: maximal reuse, no patent grant; Apache-2.0: adds patent grant; others only if they ask), get a decision, then: add `LICENSE` with the correct year/holder, add `"license"` to every package.json (root, core, worker, cli), update the README License section, and check that no bundled dependency license is incompatible.

## Acceptance Criteria

- [x] Owner has explicitly chosen a license (record the decision in a ticket note).
- [x] LICENSE file present; `license` field set in all package.json files; README License section updated.
- [x] `pnpm format:check` still clean.


## Notes

**2026-10-03T20:11:24Z**

Batch 05: no owner decision is recorded, so no LICENSE was added and nothing was chosen on the owner's behalf. README still says 'To be decided'.
AWAITING HUMAN: pick a license and record it here as a note. Options: MIT (shortest, maximal reuse, no explicit patent grant; the PLAN's likely choice) or Apache-2.0 (adds an express patent grant and a NOTICE convention; longer). Say which holder name and year to use. Then: add LICENSE, set "license" in the root, packages/core, packages/worker and packages/cli package.json files, replace the README License section, check dependency licenses (pnpm licenses list), run pnpm format:check, tick the criteria and close. Do this before the first npm publish (rf-od5l) so the package carries the license.

**2026-10-04T00:34:44Z**

2026-10-03 OWNER DECISION (recorded from the owner's message): MIT, holder 'Christian Catalan', year 2026. Done on branch batch-10-license-setup: LICENSE at root and a byte-identical copy in packages/cli (npm packs only files inside the package dir; added to its 'files'); 'license': 'MIT' in all four package.json files (cli also gets author); README License section; PLAN section 9 updated with the dependency-license check (shipped runtime deps commander, mime, hono are MIT; the Apache/ISC/BSD/MPL/CC0/LGPL packages in 'pnpm licenses list' are dev-only: workerd, sharp + libvips, lightningcss, typescript, and are not redistributed). Test in packages/cli/test/release.test.ts keeps the files in sync. npm pack --dry-run lists LICENSE. Owner also accepted the git history authors (crcatala@gmail.com / crcatala+vps@gmail.com and the GitHub noreply address); no history rewrite.
