---
name: crabyard-archive
description: Close a Crabyard change after review, verify, sync, and archive readiness are all satisfied. Use only when the user explicitly invokes `crabyard-archive` or asks for the Crabyard archive workflow.
---

Archive a completed Crabyard change once implementation and accepted truth are in sync.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/changes/<slug>/proposal.md`
4. `crabyard/changes/<slug>/design.md`
5. `crabyard/changes/<slug>/tasks.md`
6. `crabyard/changes/<slug>/execution.yaml`
7. `crabyard/changes/<slug>/specs/`
8. `crabyard/changes/<slug>/review.md` when present
9. relevant files under `crabyard/specs/`

## Workflow

1. Confirm review has been addressed or consciously accepted.
2. Run `crabyard check <change>` when the bundle's normalized `verify` metadata should execute for real.
3. Run `crabyard verify <change>`.
4. If staged change specs differ from accepted specs, run `crabyard sync <change>`.
5. Run `crabyard verify <change>` again after sync.
6. Run `crabyard archive <change>`.

## Guardrails

- Do not archive incomplete or unverified work.
- Do not skip spec sync when staged specs differ from accepted truth.
- Prefer stopping over closing an ambiguous change.
