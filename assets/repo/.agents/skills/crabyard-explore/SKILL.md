---
name: crabyard-explore
description: Explore a problem space before planning a Crabyard change. Use only when the user explicitly invokes `crabyard-explore` or asks for the Crabyard explore workflow.
---

Explore the problem, constraints, and likely solution space before committing to a formal change.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/project.md`
4. relevant files under `crabyard/specs/`
5. `crabyard/knowledge/index.md` and any directly relevant notes

## Workflow

1. Restate the user goal, affected system, and decision the exploration should unlock.
2. Run a retrieval pass before deeper investigation:
   - use the repo-local `crabyard-research` skill from `.agents/skills/` when available
   - otherwise search `crabyard/knowledge/index.md` and `crabyard/knowledge/` directly
   - keep only the strongest 1-3 prior learnings
3. Investigate the relevant code, tests, specs, active changes, and retrieved knowledge.
4. Summarize current behavior, constraints, likely approaches, open questions, and any prior learnings that materially change the decision surface.
5. Recommend the next move in the two-layer model:
   - move into the core flow with `crabyard-plan` for a formal change bundle
   - use `crabyard-debug` for a bounded bug
   - request `crabyard-review` as an optional gate when risk, ambiguity, or artifact quality should be stress-tested before apply
   - move to direct implementation only when the user explicitly rejects the workflow and risk is low

## Guardrails

- Do not create a change bundle during explore unless the user explicitly switches to the planning stage with `crabyard-plan`.
- Do not write application code during explore.
- Keep the output decision-oriented and evidence-backed.
- Do not dump every knowledge note you found; prefer the smallest useful retrieval set.
