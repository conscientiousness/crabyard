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
10. `crabyard/changes/<slug>/review.md` if it already exists

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

If implementation has not started yet, focus on proposal/design/tasks/execution/spec coherence and likely failure modes.
If implementation exists, include code/tests/staged specs against the same artifact set.

## Output format

- Report findings first.
- Prioritize as `P1`, `P2`, `P3`.
- Tie each finding to concrete evidence in code or artifacts.
- Call out mismatches between proposal, design, tasks, execution graph, staged specs, retrieved knowledge, and implementation.

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
