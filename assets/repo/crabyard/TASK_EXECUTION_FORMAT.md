# Task Execution Format

Crabyard keeps `tasks.md` human-readable and keeps scheduling truth in a sibling `execution.yaml`.

This document defines the required v0.2 format for that execution graph.

## Purpose

- Keep `execution.yaml` first-class and trustworthy.
- Keep `tasks.md` readable for humans.
- Make parallelism explicit instead of inferred.
- Keep accepted product truth out of scheduling metadata.

## Required Change Layout

```text
crabyard/changes/<slug>/
  proposal.md
  design.md
  tasks.md
  execution.yaml
  specs/
  review.md
```

`review.md` is optional. `execution.yaml` is not optional.

## Core Rule

Treat each top-level `##` section in `tasks.md` as exactly one execution unit.

`execution.yaml` must contain the same units in the same order.

Crabyard validates this as a strict one-to-one mapping.

## `tasks.md`

Use one top-level `##` section per execution unit.

Example:

```md
## 1. Parser And Validation
- [ ] Replace the hand-rolled parser
- [ ] Fail on unknown dependencies and cycles

## 2. Lifecycle Commands
- [ ] Add verify and sync
- [ ] Tighten archive readiness checks

## 3. Final Integration
- [ ] Re-run build and tests
- [ ] Update docs to match the implementation
```

## `execution.yaml`

Place `execution.yaml` next to `tasks.md`.

Example:

```yaml
version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts, src/crabyard.ts]
    verify:
      - kind: command
        argv: [pnpm, test]
        timeout_ms: 120000

  - id: T2
    title: Lifecycle Commands
    parallel: false
    depends_on: [T1]
    writes:
      - src/crabyard.ts
      - README.md
    verify:
      - kind: command
        run: pnpm test

  - id: T3
    title: Final Integration
    parallel: false
    depends_on: [T1, T2]
    writes: [README.md, package.json]
    verify:
      - kind: command
        argv: [pnpm, build]
      - kind: artifact
        path: dist/index.js
        state: exists
```

Inline-list YAML such as `depends_on: [T1, T2]` is valid and supported.

## Required Fields

Top level:

- `version`
- `tasks_file`
- `units`

Each unit:

- `id`
- `title`
- `parallel`
- `depends_on`
- `writes`
- `verify`

Optional unit fields:

- `notes`
- `allow_parallel_write_overlap`

## `verify` Semantics

`verify` is a required array of typed verification specs.

Supported entries:

- command
- artifact

Command checks:

```yaml
verify:
  - kind: command
    argv: [pnpm, test]
    cwd: packages/app
    timeout_ms: 120000
    expect_exit_code: 0
```

or shorthand:

```yaml
verify: [pnpm test]
```

String shorthand is still accepted for compatibility and normalizes to:

```yaml
- kind: command
  run: pnpm test
```

Artifact checks:

```yaml
verify:
  - kind: artifact
    path: dist/index.js
    state: exists
```

Use typed object form when the verification contract matters to downstream agents. Prefer `argv` over `run` when you want tokenized command structure.

## Matching Rules

Crabyard normalizes titles by:

- stripping the leading `##`
- stripping a leading numeric prefix such as `1.` or `2)`
- trimming whitespace

Validation then requires:

- unique top-level `##` section titles
- unique unit ids
- unique normalized unit titles
- `tasks_file: tasks.md`
- the same number of task sections and units
- the same normalized title order in both files

If any of these fail, the execution graph is invalid.

## Dependency Rules

Crabyard fails validation when:

- a `depends_on` id does not exist
- the dependency graph contains a cycle

Cycles are rejected even when the rest of the file is well-formed.

## Parallel Safety Rules

`parallel: true` means the unit is eligible for concurrent execution only when:

1. dependencies are satisfied
2. verification is meaningful on its own
3. write ownership is disjoint from other concurrently ready parallel units

Crabyard conservatively rejects overlapping `writes` between parallel units unless every overlapping unit sets:

```yaml
allow_parallel_write_overlap: true
```

Use that opt-out rarely and document the reason in `notes`.

## `writes` Ownership Semantics

Treat each `writes` entry as an ownership claim over repo-relative paths.

- exact path: `src/execution.ts`
- subtree: `src/` or `src/**`
- glob: `src/**/*.ts`, `docs/{api,guide}.md`, `src/*/index.ts`

Crabyard now compares `writes` with segment-aware glob matching instead of a raw static-prefix heuristic.

- `src/*.ts` does overlap `src/index.ts`
- `src/*.ts` does not overlap `src/readme.md`
- `src/` overlaps everything under `src/`

Prefer exact paths or narrow globs. Use subtree claims only when the unit truly owns the whole directory.

## Lifecycle Relationship

- `verify` checks that the change is structurally valid, the execution graph is trustworthy, and tasks are complete.
- `sync` copies staged accepted-truth files from `changes/<slug>/specs/` into `crabyard/specs/`.
- `archive` only closes the change after `verify` passes and sync state is coherent.

## Scope Boundaries

- Keep accepted truth in `crabyard/specs/`.
- Keep staged accepted-truth edits in `crabyard/changes/<slug>/specs/`.
- Keep scheduling truth in `execution.yaml`.
- Do not redefine product behavior in `execution.yaml`.
