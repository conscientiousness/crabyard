# Artifact Routing

Choose the destination based on future retrieval needs, not on where the current task happened.

## Decision matrix

- **Would a wrong answer change product behavior, API semantics, accepted requirements, or formal contracts?**
  - Use `crabyard/specs/`.
- **Would another engineer need to remember a repeatable debugging pattern, implementation heuristic, or operations note?**
  - Use `crabyard/knowledge/`.

## Tie-breakers

- If the content changes accepted product behavior, choose `crabyard/specs/` even when the fix also taught something useful.
- If the content is mostly diagnostic pattern plus guardrails, choose `crabyard/knowledge/`.
- If the material only explains an in-flight change and is not yet accepted truth, keep it in the active change bundle under `crabyard/changes/`.

## Anti-patterns

- Do not append knowledge blobs to `AGENTS.md`.
- Do not create a single `knowledge.md` dump file.
- Do not store accepted product behavior in `crabyard/knowledge/`.
- Do not mirror the same truth into both `crabyard/specs/` and `crabyard/knowledge/`.
