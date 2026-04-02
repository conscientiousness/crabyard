---
name: crabyard-plan
description: Plan a complete Crabyard change bundle with an explicit execution graph. Use only when the user explicitly invokes `/crabyard:plan` or asks for the Crabyard plan workflow.
---

Plan a complete Crabyard change bundle so implementation can start immediately.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/project.md`
4. relevant files under `crabyard/specs/`
5. `crabyard/knowledge/index.md` and any relevant notes
6. `crabyard/TASK_EXECUTION_FORMAT.md`

## Retrieval pass

Before structuring the change, run a Crabyard knowledge retrieval pass.

- use the repo-local `crabyard-research` skill from `.agents/skills/` when available
- otherwise search `crabyard/knowledge/index.md` and `crabyard/knowledge/` directly
- keep only the strongest 1-3 prior learnings
- distinguish accepted truth in `crabyard/specs/` from implementation knowledge in `crabyard/knowledge/`

## Bundle shape

Create or reuse:

```text
crabyard/changes/<slug>/
  proposal.md
  design.md
  tasks.md
  execution.yaml
  specs/
```

`review.md` is optional and should be created later by review work, not by default during plan.

## Workflow

1. Derive or confirm the change slug.
2. Use the retrieval results to surface prior pitfalls, implementation heuristics, and adjacent specs before writing the bundle.
3. Reuse an existing matching change directory when safe; otherwise create a new one.
4. Write `proposal.md`, `design.md`, `tasks.md`, `execution.yaml`, and an empty or staged `specs/` subtree when accepted truth will change.
5. Keep one top-level `##` section per execution unit in `tasks.md`.
6. Keep `execution.yaml` exact and trustworthy:
   - one unit per top-level task section
   - exact section-to-unit order
   - required `id`, `title`, `parallel`, `depends_on`, `writes`, `verify`
   - conservative `parallel: true`
7. Keep accepted truth updates staged in `crabyard/changes/<slug>/specs/`, not in `crabyard/specs/` yet.
8. If the retrieved knowledge contradicts older notes or reveals document drift, note a follow-up `crabyard-refresh` scope instead of silently carrying stale assumptions into the plan.

## Guardrails

- Do not start implementation during plan.
- Do not create speculative accepted truth.
- Do not omit `execution.yaml`; Crabyard depends on the explicit execution graph.
- Do not treat knowledge notes as accepted truth when specs disagree.
