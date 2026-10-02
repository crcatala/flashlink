---
id: rf-v39y
status: open
deps: [rf-rxkx]
links: []
created: 2026-10-02T20:05:53Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, worker, cli, idea]
---
# Large files (>100 MB) via R2 multipart uploads through the Worker

## Why
The Worker accepts request bodies up to 100 MB on the free/pro plans, so the hard file ceiling is 100 MiB (default cap 50 MiB). Videos and large zips exceed that. Supporting bigger files without adding credentials or complexity would widen the tool's usefulness.

## Design

Prefer the R2 BINDING's multipart API through the Worker over presigned S3 URLs (presigned URLs need R2 API tokens as extra secrets and S3 endpoint config, which complicates forking): `env.BUCKET.createMultipartUpload(key)`, `upload.uploadPart(n, body)`, `complete(parts)`, `abort()`. The client splits the file into parts (each <= ~50 MB, so each request stays under the body limit) and sends them to new endpoints, for example `POST /api/uploads` (start; allocates the code + pending row + reserves quota for the declared total size), `PUT /api/uploads/:code/parts/:n`, `POST /api/uploads/:code/complete`, `DELETE /api/uploads/:code` (abort). Must reuse the existing pending/commit/abort model and the sweeper's pending reaper, and also abort the R2 multipart upload when reaping (otherwise unfinished multipart data accrues storage; also add `--abort-multipart-days` to the lifecycle rule in the README).
Keep `MAX_FILE_BYTES` as the single policy knob (raise the hard ceiling only for multipart). Quota accounting must use the declared size and verify the final size on complete. Retries: parts are idempotent by part number. Client: progress output on stderr, resume is out of scope.

## Acceptance Criteria

- [ ] Files above 100 MiB (up to a new configurable ceiling) upload successfully and download byte-identically; a 150 MB test is exercised against `wrangler dev` (manual) and a small-part-size variant is covered by automated tests.
- [ ] Abandoned multipart uploads are aborted by the sweeper (R2 side too) and never leave untracked storage; tests cover abort, reap and failed complete.
- [ ] Quota and size policy enforced at start and verified at complete.
- [ ] Single DO instance and "DO never sees bytes" invariants hold; one DO call per part is NOT allowed to scale cost unboundedly (document the per-upload DO call count; prefer none per part).
- [ ] README and docs/PLAN.md updated (including the lifecycle rule for incomplete multipart uploads).

