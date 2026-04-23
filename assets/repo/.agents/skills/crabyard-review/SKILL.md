---
name: crabyard-review
description: Review a Crabyard change against its proposal, design, tasks, execution plan, code, and relevant specs. Use when the user asks for a Crabyard review workflow or wants prioritized review findings before apply or before closure.
---

Review a Crabyard change either before implementation starts or before lifecycle closure.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/project.md`
4. `crabyard/changes/<slug>/proposal.md`
5. `crabyard/changes/<slug>/design.md`
6. `crabyard/changes/<slug>/tasks.md`
7. `crabyard/changes/<slug>/execution.yaml`
8. relevant files under `crabyard/specs/`
9. relevant code and tests

Do not probe for a previous persisted review by default. Read one only when the user mentions it or a normal change directory/status listing already shows that it exists.

## Retrieval pass

Before reviewing, run a Crabyard knowledge retrieval pass for the change area.

- use the repo-local `crabyard-research` skill from `.agents/skills/` when available
- otherwise search `crabyard/knowledge/index.md` and `crabyard/knowledge/` directly
- keep only the strongest 1-3 prior learnings that materially inform correctness, risk, or testing

## Review goals

Focus on:

- correctness
- risk
- maintainability
- coherence between artifacts
- testing gaps
- scope discipline

If implementation has not started yet, focus on proposal/design/tasks/execution/spec coherence and likely failure modes.
If implementation exists, include code/tests/staged specs against the same artifact set.

## Scope and change-discipline checks

Review the change against task-aware bounded change discipline.

Check:

1. whether the implementation matches the task type:
   - fix
   - feature
   - refactor
   - migration
2. whether the observed diff is appropriately bounded for that task type
3. whether unrelated cleanup, abstraction, renaming, or restructuring was folded into the change without justification
4. whether accepted behavior was preserved when the task was framed as a refactor or migration
5. whether any behavior changes were made without corresponding updates to task artifacts, specs, or verification
6. whether `design.md` covers workflow shape adequately when it matters:
   - workflow inventory
   - main path
   - branches and decision points
   - failure modes and recovery
   - handoff contracts
   - verification implications
7. whether the verification depth is appropriate for the task type:
   - fixes should prove the defect is resolved
   - features should prove the new behavior works
   - refactors should prove behavior parity where expected
   - migrations should prove sequence safety and integration correctness

## Output format

- Report findings first.
- Prioritize as `P1`, `P2`, `P3`.
- Tie each finding to concrete evidence in code or artifacts.
- Call out mismatches between proposal, design, tasks, execution graph, staged specs, retrieved knowledge, and implementation.
- When scope discipline is violated, report it explicitly and distinguish between justified structural change, task-compatible refactor scope, and unjustified scope creep.
- Use this severity guidance:
  - `P1`: the change exceeds task scope and changes behavior or introduces material risk
  - `P2`: the change exceeds the declared refactor or migration scope without clear justification
  - `P3`: the change includes minor incidental edits or avoidable overreach without material behavior change

## Optional writeback

When asked to persist the review, write or update:

```text
crabyard/changes/<slug>/review.md
```

Keep the file focused on prioritized findings, open questions, and verification gaps.

## Guardrails

- Do not turn review into implementation unless the user explicitly changes modes.
- Prefer no finding over weak speculation.
- Treat `execution.yaml` as first-class review input, not incidental metadata.
- Treat retrieved knowledge as evidence to check, not truth to obey blindly.
