---
name: crabyard-research
description: Search Crabyard knowledge and specs for relevant prior learnings before exploring, planning, review, or implementation. Use when the current task may benefit from durable implementation notes, prior debugging lessons, or accepted truth already stored in the repo.
---

Search the Crabyard knowledge layer and return only the strongest prior learnings for the current task.

## When to use

- Before `explore`, `plan`, or `review`
- Before debugging or implementing work in an area that may already have prior lessons
- When the task mentions a known module, file path, component, error string, or architecture topic

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml` if it exists
3. `crabyard/project.md` if it exists
4. `crabyard/knowledge/index.md` if it exists
5. relevant files under `crabyard/specs/` when the task touches accepted behavior

If the manifest or knowledge index is missing, infer conservatively from the repo structure and report the gap.

## Core model

Find the smallest set of prior artifacts that can materially improve the current task.

- return at most 3 strong matches by default
- prefer direct relevance over thematic similarity
- say so clearly when no strong match exists

## Retrieval workflow

### Phase 1: Extract retrieval signals

From the current task, extract:

- module names
- file paths
- component names
- error strings
- product surfaces
- root-cause terms
- architecture terms

### Phase 2: Search the knowledge layer

Search `crabyard/knowledge/index.md` first, then search `crabyard/knowledge/` directly.

Use a grep-first strategy:

1. search exact file names, symbols, and error strings
2. search module and feature names
3. search related tags or architecture terms
4. read only the strongest candidates

When the task touches accepted behavior, also inspect the most relevant files under `crabyard/specs/` so knowledge is not mistaken for accepted truth.

### Phase 3: Rank candidates

Rank candidates by:

- symptom match
- module or file overlap
- root-cause similarity
- fix or guardrail similarity
- whether the note is indexed canonically

Discard weak matches.

### Phase 4: Synthesize for the current task

For each strong match, answer:

- why it matters now
- what prior lesson or guardrail applies
- what to check immediately
- what should not be repeated
- whether the note still needs verification against current code

### Phase 5: Detect drift

If a retrieved note appears stale, contradictory, or superseded relative to current code or specs, recommend `crabyard-refresh` with the narrowest useful scope.

## Output

Use this shape when helpful:

- `Relevant knowledge`
- `Why it matches`
- `Apply now`
- `Watch out`
- `Confidence`

If nothing useful is found, say that explicitly and list the main areas searched.

## Guardrails

- Do not create or edit artifacts in this workflow.
- Do not treat knowledge notes as accepted truth when specs or code contradict them.
- Prefer 1-3 high-confidence matches over long dumps.
