---
name: crabyard-debug
description: Debug and fix a concrete bug or regression in Crabyard mode. Use only when the user explicitly invokes `crabyard-debug` or asks for the Crabyard debug workflow.
---

Debug a concrete problem, gather evidence, and fix it when the scope remains bounded.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. relevant files under `crabyard/specs/`
4. `crabyard/knowledge/index.md`
5. any relevant knowledge notes

## Workflow

1. Capture the expected behavior, actual behavior, reproduction, and scope.
2. Reproduce or otherwise gather evidence from logs, tests, and code.
3. Treat debug work as behavior-fix-first unless the evidence proves the issue is actually a larger refactor or behavior change.
4. Prefer the smallest evidence-backed correction that resolves the verified problem.
5. Do not turn debugging into opportunistic cleanup, abstraction work, or structural redesign.
6. If the fix requires broader structural change, stop and recommend moving into the planning stage with `plan` unless the current change artifacts already authorize that scope.
7. After the fix, re-check that the original defect is addressed and unrelated behavior was not changed accidentally.
8. Record follow-up improvements separately instead of mixing them into the debug patch.
9. Recommend `learn` or `refresh` when the result should become durable knowledge.

## Guardrails

- Do not brute-force speculative changes without evidence.
- Do not use a debug task to smuggle in refactors.
- Prefer stopping with a scope recommendation over applying a speculative broad fix.
- Do not turn a broad product change into a debug task just to move faster.
