---
name: crabyard-apply
description: Apply a planned Crabyard change to the codebase. Use only when the user explicitly invokes `/crabyard:apply` or asks for the Crabyard apply workflow.
---

Apply a planned Crabyard change by implementing its bundle.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/project.md`
4. `crabyard/changes/<slug>/proposal.md`
5. `crabyard/changes/<slug>/design.md`
6. `crabyard/changes/<slug>/tasks.md`
7. `crabyard/changes/<slug>/execution.yaml`
8. relevant files under `crabyard/specs/`
9. relevant knowledge notes

## Workflow

1. Validate that the bundle is executable and that `execution.yaml` matches `tasks.md`.
2. Use `execution.yaml` as the scheduling source of truth.
3. Run units serially unless `parallel: true`, dependencies are satisfied, and write ownership is genuinely disjoint.
4. Implement the work and keep `tasks.md` checkboxes aligned with integrated progress.
5. Stage accepted-truth edits in `crabyard/changes/<slug>/specs/` instead of mutating `crabyard/specs/` directly.
6. Stop when the change is implemented and ready for review.

## Guardrails

- Do not ignore a contradictory or invalid `execution.yaml`.
- Do not archive during apply.
- Do not sync accepted specs during apply unless the user explicitly asks to leave apply mode.
