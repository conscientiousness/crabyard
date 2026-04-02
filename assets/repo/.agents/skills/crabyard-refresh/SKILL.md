---
name: crabyard-refresh
description: Refresh stale Crabyard knowledge and the knowledge index after refactors, migrations, contradictory learnings, or documentation drift.
---

Refresh repo-native Crabyard knowledge without touching `CLAUDE.md`.

## When to use

- A new fix contradicts an older knowledge note.
- A refactor or rename likely broke doc references.
- Multiple notes seem to cover the same topic and may need consolidation.
- `crabyard/knowledge/index.md` looks stale relative to the actual docs.

## Inputs to read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/knowledge/index.md`

If the manifest is missing, infer conservatively and recommend adding it.

## Scope handling

Treat the user argument as a scope hint. Match in this order:

1. exact file path
2. directory name
3. filename fragment
4. tag or keyword

If no scope is given, scan all paths in the manifest's `refresh_scope`.

## Modes

- **Interactive**: default; ask only when the correct action is genuinely ambiguous.
- **Autofix**: enabled when the argument contains `mode:autofix`; apply safe updates without pausing.

## Outcome classes

- **Keep**: still accurate and still worth retrieving
- **Update**: references, wording, or guardrails drifted but the core truth still stands
- **Consolidate**: two notes overlap too heavily and should become one canonical doc
- **Replace**: the existing note is now misleading and needs a successor
- **Stale**: evidence suggests drift, but the correct write action is not yet strong enough

## Refresh workflow

### Phase 1: Build the candidate set

Use the manifest's `refresh_scope` paths. Exclude generated files and ignore obvious placeholders.

### Phase 2: Investigate each candidate

Check:

- referenced paths and modules
- whether the current code still supports the documented advice
- whether another note already covers the same retrieval target better
- whether the index entry still points to the right canonical note

### Phase 3: Decide the action

Use `references/refresh-policy.md` for action criteria.

In autofix mode:

- apply safe updates directly
- consolidate only when one note clearly subsumes another
- prefer narrow, targeted refresh over broad rewrites when one topic changed
- mark ambiguous cases as stale instead of guessing

### Phase 4: Update the index

Whenever a note changes state:

- refresh the entry in `crabyard/knowledge/index.md`
- remove entries for deleted or subsumed notes
- add or update a `supersedes` signal when a newer note becomes the canonical retrieval target
- keep one canonical entry per retrieval target

### Phase 5: Report

Summarize:

- applied actions
- stale or recommended follow-ups
- any manifest gaps or routing mismatches found

## Guardrails

- Never write to `CLAUDE.md`.
- Keep `AGENTS.md` unchanged unless the routing policy itself is wrong.
- Prefer stale marking over aggressive rewriting when evidence is borderline.
- Do not create replacement notes without concrete successor evidence.
