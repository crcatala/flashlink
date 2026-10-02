---
id: rf-uwe2
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, worker, api]
---
# Phase 1.4: Authenticated upload and management API

## Why
Clients need to upload and manage links; everything state-changing must be authenticated with a single static bearer token (single-user design).

## What was done (packages/worker/src/api.ts, auth.ts)
Routes under `/api` (bearer token; constant-time compare over SHA-256 digests; missing `UPLOAD_TOKEN` fails closed with 500): `POST /api/links` (upload, new code), `PUT /api/links/:code` (re-create a purged code, 409 if it exists), `GET /api/links/:code`, `POST /api/links/lookup` (batch, max 100), `POST /api/links/:code/refresh`, `POST /api/links/:code/revoke`, `DELETE /api/links/:code` (purge), `GET /api/status` (limits + usage).
Upload flow: require `Content-Length` (411 otherwise), 413 before reading the body if over the cap, `allocate` -> stream body to R2 -> verify stored size -> `commit`. On any failure or if commit finds no pending row, the object is deleted (unless a live link now owns the code) and the pending row aborted. Metadata travels in headers (`X-Filename` percent-encoded, `X-TTL-Seconds`, `X-Max-Downloads`, `Content-Type`).

## Acceptance Criteria

- [x] All routes covered by tests incl. auth failures (401 + WWW-Authenticate), size/quota errors (413/507/429), PUT re-create, lookup validation.
- [x] A short/failed upload leaves no row and no object; a late upload (pending row reaped) leaves no untracked object.
- [x] Unauthenticated requests never reach the registry.


## Notes

**2026-10-02T20:05:53Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
