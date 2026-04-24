---
name: crabyard-learn
description: Learn from solved work by capturing durable repository knowledge without mutating CLAUDE.md. Use when the user asks to preserve a reusable lesson, record an implementation pattern, or maintain Crabyard knowledge.
---

Learn from completed work while keeping `AGENTS.md` lean and the repo-local memory searchable.

## When to use

- The user asks to preserve a solved lesson or make a workflow reusable.
- A fix revealed a repeatable debugging pattern, implementation heuristic, or operations note.
- A recently completed task should leave behind reusable knowledge for future work.
- The repo wants durable memory without using `CLAUDE.md`.

## Inputs to read first

Before writing anything, read these in order:

1. `AGENTS.md`
2. `crabyard/manifest.yaml` if it exists
3. `crabyard/project.md` if it exists
4. `crabyard/knowledge/index.md` if it exists

If the manifest is missing, infer conservatively from the repo structure, continue, and recommend adding it at the end.

Use `references/manifest-contract.md` to understand the manifest fields.

## Core model

Choose exactly one primary destination for the new knowledge:

- **Accepted product behavior, contracts, or formal rules**: update `crabyard/specs/`.
- **Durable implementation, debugging, or operations knowledge**: write a focused note under `crabyard/knowledge/`.

Use `references/artifact-routing.md` when the destination is unclear.

The destination must reflect future retrieval value, not where the current task happened.

Treat `crabyard/knowledge/index.md` as the human-readable and LLM-readable retrieval index. Do not introduce a second index, generated database, embedding cache, or repo-wide metadata migration unless the user explicitly asks for one.

## Workflow

### Phase 1: Capture the source

Use the current conversation, implemented diff, task artifacts, and recent verification output to answer:

- What was the actual problem or decision?
- What changed?
- What part is durable enough to be useful later?
- Did the task change accepted behavior, or only explain how to implement or debug something?

If the task did not produce durable knowledge, stop and say so instead of creating a low-value doc.

### Phase 2: Route using Crabyard

Use `crabyard/manifest.yaml` when present.

- Respect the manifest's root paths and write restrictions.
- Keep accepted product behavior in `crabyard/specs/`.
- Keep durable debugging, implementation, and operations notes in `crabyard/knowledge/`.
- Do not create a second routing system outside `crabyard/`.

### Phase 3: Search for overlap before writing

Search `crabyard/knowledge/` first, then adjacent spec files when the topic may already exist elsewhere.

Use a grep-first strategy:

1. Extract topic keywords, modules, filenames, error strings, user-language aliases, symptoms, or architectural terms.
2. Search candidate files using exact terms first, then likely synonyms.
3. Read only the strongest matches.
4. Score overlap using `references/overlap-policy.md`.

Use these actions:

- **High overlap**: update the existing document instead of creating a duplicate.
- **Moderate overlap**: create a distinct focused doc only if it improves retrieval; otherwise update and broaden the existing one.
- **Low overlap**: create a new focused doc.

### Phase 4: Write one primary artifact

Write or update exactly one primary artifact.

- Prefer updating an existing focused doc over creating sibling duplicates.
- Keep filenames stable when updating.
- Use structured frontmatter from `references/entry-templates.md` when it improves retrieval. Preferred optional fields are `kind`, `tags`, `aliases`, `concepts`, `paths`, `related_specs`, `related_changes`, `supersedes`, and `last_verified_at`.
- Add `aliases` only for query phrases a future agent or human is likely to use, especially symptom wording that differs from the implementation name.
- Add `concepts` only for durable architecture or workflow concepts that help grouping without creating a broad catch-all note.
- Do not backfill optional frontmatter across old notes just to normalize style. Add or improve metadata only on the note being created or materially updated.
- Keep sections compact and concrete.

### Phase 5: Update the knowledge index

After writing or updating a knowledge note:

1. Update `crabyard/knowledge/index.md`.
2. Add or refresh a one-line entry using `references/index-entry-format.md`.
3. When the new note supersedes an older note, record that relationship in the index entry when it helps retrieval.
4. Remove stale index entries if the path changed or a doc was consolidated.
5. Ensure the index line contains the strongest retrieval terms from the note's tags, aliases, concepts, paths, symptoms, and summary without becoming a second copy of the note.

Spec edits do not need a knowledge index entry unless a separate durable knowledge note was also created.

### Phase 6: Decide whether refresh is needed

If the new learning contradicts older notes, reveals stale references, or subsumes an older entry, recommend or run the `crabyard-refresh` skill with the narrowest useful scope.

## Output rules

- Never write to `CLAUDE.md`.
- Keep `AGENTS.md` stable. Update it only when the routing policy or manifest route changes.
- Prefer small, topic-specific documents over monolithic files such as `knowledge.md`.
- Use the manifest as the machine-readable contract when present.
- Do not mirror accepted product truth into `crabyard/knowledge/`.
- Preserve existing knowledge note formats when they are valid. Crabyard knowledge metadata is additive and optional, so old notes do not need migration before they can remain useful.

## Naming guidance

- `crabyard/knowledge/<topic>.md`
- `crabyard/specs/<topic>.md`

Use lowercase kebab-case names unless the repo already follows a different convention.

## Content guidance

Use the smallest template that preserves future reuse. Read `references/entry-templates.md` when you need a structure.

## Completion checklist

- Correct destination chosen
- Overlap checked before writing
- One focused primary artifact created or updated
- `crabyard/knowledge/index.md` updated when knowledge changed
- Optional metadata added only where it improves retrieval
- `AGENTS.md` unchanged unless routing policy actually changed
- `crabyard-refresh` recommended or invoked when drift was discovered
