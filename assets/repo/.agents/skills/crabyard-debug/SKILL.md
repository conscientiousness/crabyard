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
3. Fix the bounded issue when the intended behavior is already clear.
4. If the issue expands into a broader behavior change, stop and recommend moving into the planning stage with `plan`.
5. Recommend `learn` or `refresh` when the result should become durable knowledge.

## Guardrails

- Do not brute-force speculative changes without evidence.
- Do not turn a broad product change into a debug task just to move faster.
