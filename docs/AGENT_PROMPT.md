# Agent prompt: implement the next batch

One reusable prompt. Paste it into a fresh agent session at the repo root each time; it works out which batch is next from the tickets in `.tickets/` and the open PRs, implements it, and opens one PR. PRs are strictly sequential: review and merge each one before pasting the prompt again.

## Where "what's next" comes from

Every unfinished ticket carries a tag `batch-NN` (the PR order). The agent picks the **lowest-numbered batch that still has an `open` ticket**. `tk` statuses drive everything:

| Status        | Meaning                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`        | Not started. Eligible to be picked up.                                                                                                             |
| `in_progress` | Being worked on, **or** the agent's part is done and a human step remains (the ticket has a note starting `AWAITING HUMAN:`). Not picked up again. |
| `closed`      | All acceptance criteria verified.                                                                                                                  |

## Batches (source of truth is the `batch-NN` tags; this table is a convenience)

| Batch | Tickets                                                              | Why together / notes                                                                                                                                                                                                        | Human involvement                                |
| ----- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 01    | `rf-cl6p` CI                                                         | Small and first, so every later PR gets checks.                                                                                                                                                                             | none                                             |
| 02    | `rf-rxkx` real-deploy verification                                   | Agent builds `scripts/verify-deployment.mjs` + runbook; **you run it** against a real Cloudflare deployment. Unblocks 09, 11, 12.                                                                                           | **yes** (real account)                           |
| 03    | `rf-hx3f` CLI `--notify` + JSON errors                               | CLI-only prerequisite for the Quick Action.                                                                                                                                                                                 | notification check on a Mac (optional here)      |
| 04    | `rf-0q8c`, `rf-smnk`, `rf-e9az` Quick Action, lifetime picker, docs  | The picker edits the wrapper created in `rf-0q8c`, and the docs describe both; one PR avoids churn.                                                                                                                         | **yes** (a Mac)                                  |
| 05    | `rf-od5l` npm release prep, `rf-kphq` standalone binary distribution | Release plumbing: how people get `r2fl` (npm package, release binary) is one decision. Agent prepares packaging, the release workflow and the decision note but never publishes. The license (`rf-cr7d`) moved to batch 10. | yes (decision approval; publishing waits for 10) |
| 06    | `rf-chq2` secret warning                                             | Small, CLI-only. Safety net before using the tool a lot.                                                                                                                                                                    | none                                             |
| 07    | `rf-gah1` folder zip                                                 | Adds a directory input source to `up`; the Quick Action is handed folders too. (Clipboard upload `rf-4514` is parked, see below.)                                                                                           | none                                             |
| 08    | `rf-xxew` agent skill (`SKILL.md`)                                   | Skill file only. The MCP server and scoped tokens are split out into `rf-h4so` (parked).                                                                                                                                    | none                                             |
| 09    | `rf-dd4u` download-cap policy                                        | Worker-only. After the dogfooding checkpoint, so real use shows whether the cap's quirks matter.                                                                                                                            | policy decision (agent proposes)                 |
| 10    | `rf-cr7d` license, `rf-dt1g` setup script + deploy button            | **Go public.** Done in one PR: MIT license (`rf-cr7d`, closed) and the setup script (`rf-dt1g`; the Deploy button was evaluated and is not offered, see PLAN section 8). What remains is human: a clean-account run of `pnpm setup:cloudflare`, then the go-public checklist below. The release tooling (`rf-in0j`, release-it + changelog) is untagged on purpose: do it before the first tag.                                    | **yes** (license, clean account run, publishing) |
| 11    | `rf-v39y` large files (multipart)                                    | P4 idea: agent asks before starting.                                                                                                                                                                                        | yes                                              |
| 12    | `rf-l2ym` edge cache                                                 | P4 idea: only if measurements justify; agent asks first.                                                                                                                                                                    | yes (measurements)                               |
| 13    | `rf-j60m` multi-machine history                                      | P4 idea: decision ticket.                                                                                                                                                                                                   | yes (decision)                                   |

Order rationale: build the features that make daily use pleasant (06 to 08), use the tool for real, and only then do the release and public-repo work (10). Tickets keep their ids when batches move; only the `batch-NN` tag and this table change.

Deferred, with no batch tag so the picker skips them: epic `rf-yofr` (native Finder Sync app) and its children `rf-kecm`, `rf-kwsu`, `rf-16ho`, `rf-szpx`, `rf-0yp9`, `rf-txf4`. PR #12 chose a standalone `r2fl` binary over a Swift client (`rf-dgve`, closed), so a future app would be a thin shell that spawns it. Pick them up only when the owner asks for the root-level Finder menu.

## Checkpoints (human, no prompt)

These are not batches, so the picker never takes them. Pause there on purpose.

1. **Dogfooding checkpoint, after batch 08 and before batch 09.** Merge the batch 05 to 08 PRs, install it on your Mac (`macos/install.sh` from a checkout, or `--latest` once a private tagged release exists), and use the tool for a few days (Quick Action, CLI, the skill with an agent). Then do `rf-bi4a` (compare Cloudflare usage with PLAN section 5) and note anything annoying; adjust the remaining tickets from what you learn. `rf-bi4a` has no batch tag and is never picked by the prompt.
2. **Go-public checklist, batch 10.** Close `rf-cr7d` (pick the license, record it in a note), run batch 10, make the repo public, add the `NPM_TOKEN` repository secret, bump `packages/cli` version, then tag `v0.1.0` (npm provenance only works from a public repo). The remaining steps are in the `AWAITING HUMAN` notes on `rf-od5l` and `rf-kphq`.

Also parked, with no batch tag: clipboard image upload `rf-4514` (parked by the owner to reconsider later; revive it by adding a `batch-NN` tag) and the MCP server plus scoped tokens `rf-h4so`.

## The prompt

```text
You are implementing the next batch of work for the r2-fastlink repo (your cwd is the repo root). Work is delivered as ONE PR PER BATCH, strictly sequential. Do the work yourself (do not spawn subagents). Work autonomously all the way to an open PR; only stop to ask me when you are blocked on something only I can decide or do.

## 1. Find out where we are
1. `git fetch origin && git checkout main && git pull --ff-only`. If `.tickets/` does not exist on main, STOP and tell me.
2. `gh pr list --state open --json number,title,headRefName,url`. If any open PR has a head branch starting with `batch-`, STOP and tell me which PR needs review/merge before the next batch (PRs are sequential).
3. Read the epic with `tk show rf-dek6`. Its repo orientation, commands, and "Invariants every ticket must preserve" apply to everything you do. Also read the docs/PLAN.md sections that your tickets cite.
4. Pick the batch. Unfinished tickets carry a tag `batch-NN`. The next batch is the LOWEST-numbered batch that has at least one ticket with status `open` (list a batch with `grep -l 'batch-NN' .tickets/*.md`, check readiness with `tk ready -T batch-NN` and `tk blocked -T batch-NN`). Tickets that are `in_progress` or `closed` do not make a batch eligible.
   - If tickets in that batch are blocked by an open ticket OUTSIDE the batch, STOP and tell me which ticket blocks it and what human action would unblock it. (A blocker inside the same batch is fine: do it first.)
   - If a ticket in that batch is `in_progress` with no open PR and no note starting `AWAITING HUMAN:`, a previous attempt was abandoned: resume it (inspect `git branch -a` and `git log`).
   - If every remaining open ticket in the batch is tagged `idea` AND is priority 4, do NOT implement it. Describe what the batch contains and ask for my go-ahead.
   - If no batch has an open ticket, say so and stop.
5. Tell me in one short paragraph which batch you chose and why, then continue.

## 2. Understand before coding
Run `tk show <id>` for every ticket in the batch and for their dependencies. A ticket's Why, Design, and Acceptance Criteria are the spec, and any `SCOPE FOR AN AGENT` note narrows what an agent should deliver. Read the code you will touch first. If a ticket's design conflicts with what the code actually does, trust the code and the epic invariants, adapt, and record the deviation in the PR and in a ticket note. Do not expand scope beyond the batch's tickets.

## 3. Implement
- Create a branch `batch-NN-<short-slug>` from main. Run `tk start <id>` for each ticket you work on.
- Implement ticket by ticket with logical commits (conventional-style messages, ending with the Co-Authored-By trailer from your system reminder if you have one). Stage `.tickets/` changes together with the code.
- Tests are required for every behavior change (epic invariant 7). A regression test must fail on the old behavior; verify that when fixing a bug.
- Keep README.md and docs/PLAN.md in sync with any change in behavior, defaults, or decisions.
- Before opening the PR all of these must pass: `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`; and, if the Worker changed, `wrangler deploy --dry-run` (from packages/worker: `pnpm exec wrangler deploy --dry-run --outdir <scratch dir>`).
- Exercise the real thing, not only unit tests: for Worker or CLI changes, run the built CLI against `wrangler dev` (see Environment notes).
- NEVER: push to main, merge a PR, publish to npm, touch a real Cloudflare account or credentials, commit secrets or tokens, or edit tickets outside this batch (adding a note is fine).

## 4. Verify visually
Capture 2-4 representative screenshots of the feature working, and inspect every image before using it:
- CLI / terminal behavior: the terminal-capture skill.
- Landing page or any web UI: the agent-browser skill.
- Getting images into the PR: the github-pr-screenshots skill (after the PR exists).
If a change has nothing visual, include a short command-output transcript in the PR instead and say so. Keep captures in your scratch/tmp dir; never commit them.

## 5. Close out the tickets honestly
For each ticket in the batch, walk its acceptance criteria. Change `- [ ]` to `- [x]` in the ticket file ONLY for criteria you actually verified, and add a `tk add-note` summarizing what was done (branch/PR, commits, deviations, evidence).
- Every criterion verified: `tk close <id>`.
- Some criteria need a human (a real Mac, a real Cloudflare account, an owner decision, publishing to npm): leave those unchecked, leave the ticket `in_progress`, and add a note starting `AWAITING HUMAN:` that says exactly what remains and how to do it.
Commit the `.tickets/` changes in the PR.

## 6. Open the PR
Push the branch and run `gh pr create --base main`. The body must have: Summary; Screenshots (create the PR with a placeholder, then upload with github-pr-screenshots and embed the exact markdown `gh attach` returns); Technical details (what changed and where, design decisions, deviations from the tickets or plan and why); Testing (commands run, results and counts, and what you could NOT verify and why); Tickets (closed / left in progress and why); Human steps (if any). End the body with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Do not merge the PR and do not start the next batch.

## 7. Final message to me
Keep it short: the PR link; a one-paragraph summary; which tickets are closed and which are left in progress; anything you could not verify. Then, if any ticket needs a human (in this batch, or earlier ones still `in_progress`; find them with `grep -l 'AWAITING HUMAN' .tickets/*.md`), end with a section titled **Human steps needed**. For each such ticket give: id and title; the exact steps or commands; what to look for; and where to record the result (which ticket note, and which criteria to tick). Be concrete enough that I can do it without re-reading the ticket.

## Environment notes (this dev container)
- Linux only, Node 22.12+, pnpm. You cannot run macOS-specific things: say so, rely on tests, and list the manual Mac steps under Human steps.
- `wrangler dev` must run inside tmux (a hook blocks background processes): `tmux new-session -d -s dev -c packages/worker "pnpm exec wrangler dev --port 8787 --persist-to <scratch>/state 2>&1 | tee <scratch>/dev.log"`. Put `R2FL_TOKEN=<dev token>` in `packages/worker/.dev.vars` (git-ignored). Kill the tmux session when finished.
- Use `/usr/bin/curl`, not the `curl` on PATH: the wrapper in ~/.local/bin corrupts piped binary output.
- Prefix test commands with `RTK_DISABLED=1` when you need unabridged output (rtk compresses command output).
- agent-browser: export a task-specific `AGENT_BROWSER_SESSION` before every call and close the session at the end.
- The Worker's `compatibility_date` must not exceed what the local workerd supports (currently pinned to 2026-08-01).
```

## Maintaining this

- To change the order or grouping, edit the `batch-NN` tags in the ticket frontmatter (and this table). The prompt itself never changes.
- A new ticket joins the queue by getting a `batch-NN` tag. Tickets without one are never picked up.
- After a human step is done, close the ticket (`tk close <id>`) so batches that depend on it become unblocked.
