<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/crabyard-logo-lockup-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./docs/assets/crabyard-logo-lockup-light.png">
    <img src="./docs/assets/crabyard-logo-lockup-light.png" alt="Crabyard" width="420">
  </picture>
</p>

<h1 align="center">Crabyard</h1>

<p align="center">
  <strong>Keep coding agents aligned as your repo evolves.</strong>
</p>

<p align="center">
  <a href="https://github.com/conscientiousness/crabyard/actions/workflows/ci.yml?branch=main">
    <img src="https://img.shields.io/github/actions/workflow/status/conscientiousness/crabyard/ci.yml?branch=main&style=for-the-badge" alt="CI status">
  </a>
  <a href="https://github.com/conscientiousness/crabyard/releases">
    <img src="https://img.shields.io/github/v/release/conscientiousness/crabyard?include_prereleases&style=for-the-badge" alt="GitHub release">
  </a>
  <a href="https://www.npmjs.com/package/crabyard">
    <img src="https://img.shields.io/npm/v/crabyard?style=for-the-badge" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/crabyard">
    <img src="https://img.shields.io/node/v/crabyard?style=for-the-badge" alt="Node.js version">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License">
  </a>
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="./README.zh-TW.md">繁體中文</a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#getting-started">Getting Started</a>
  ·
  <a href="#cli-commands">CLI Commands</a>
</p>

Crabyard started from a simple observation: once you use coding agents seriously, the hard part is usually not getting them to write code. The hard part is keeping the repo understandable from one session to the next.

Tasks drift away from execution. Accepted product behavior gets mixed with draft ideas. Review findings disappear between turns. A week later, you still have code, but you no longer have a clean shared understanding of what is done, what is blocked, and what is safe to change.

Crabyard is a small repo-local layer meant to stop that drift before it becomes normal. It gives the agent a stable place to look for the plan, the execution truth, the accepted product truth, and the durable implementation knowledge, so the repo carries more of the working memory instead of leaving it scattered across chat history.

Concretely, it keeps these things separate:

- human-readable task planning in `tasks.md`
- machine-checkable execution truth in `execution.yaml`
- accepted product truth in `crabyard/specs/`
- in-flight accepted-truth edits in `crabyard/changes/<slug>/specs/`
- durable implementation and debugging knowledge in `crabyard/knowledge/`

That creates a much cleaner loop for agent-assisted development:

```text
You -> ask Codex/OpenCode for a change
     |
     v
crabyard plan/change bundle
     |
     v
agent reads proposal/design/tasks/execution
     |
     +--> status --json says:
     |      - what is ready now
     |      - what is blocked
     |      - what verify checks matter
     |
     v
agent implements one safe unit at a time
     |
     v
verify -> sync -> verify -> archive
     |
     v
repo stays coherent for the next session
```

The point is not documentation for its own sake. The point is to make agents more dependable at:

- planning and reviewing changes
- understanding execution order and parallelism
- enforcing write ownership
- expressing verification contracts
- syncing accepted truth
- preserving reusable knowledge

The most important design choice is explicit execution graphs in `execution.yaml`. `tasks.md` stays readable for humans, while scheduling, dependencies, write ownership, and verification metadata stay machine-checkable.

## What The Agent Actually Gets

From the agent's side, the payoff is very concrete. Crabyard turns repo state into a few stable questions with stable answers. Instead of reconstructing intent from chat, the agent can validate the change bundle, inspect the current frontier, and see what still has to happen before work can close.

In practice, that usually means:

- deterministic validation for change bundles
- `status --json` for repo and change state
- execution frontier data with ready and blocked units
- typed verification metadata with legacy shorthand compatibility
- repo-local skills installed under `.agents/skills/`

## Why This Feels Better With Codex/OpenCode

Without Crabyard:

```text
prompt -> agent edits code -> you inspect diff -> prompt again -> hope context stays aligned
```

With Crabyard:

```text
prompt
  -> change bundle
  -> explicit execution graph
  -> agent works against a known frontier
  -> deterministic verify/sync/archive gates
  -> reusable knowledge for the next task
```

That usually means:

- less re-explaining the same task every session
- fewer accidental edits outside intended ownership
- easier handoff between planning, implementation, and review
- much better visibility into "what should the agent do next?"

## Design Goals

Crabyard is intentionally small.

It is not trying to become a giant framework, a plugin marketplace, or a full operating system for AI development. The idea is simpler than that: give one repo a clear working memory, a clear execution contract, and a clean way to preserve what it learns.

That means keeping durable context inside the repo, separating readable planning from machine-checkable execution state, and making it obvious what is ready, what is blocked, and what is safe to close. If a workflow makes that harder instead of easier, it does not belong here.

## How Crabyard Differs

Projects like Compound Engineering and OpenSpec are doing real work in this space, and Crabyard borrows the core insight that AI-assisted development gets better when the repo itself carries more structure.

The difference is mostly about scope.

Compound Engineering is broader and more ecosystem-shaped. It spans more tools, more workflows, and more reusable process. That can be powerful. Crabyard is aimed at the case where you want less surface area, not more: one repo, one small contract, and a workflow that an agent can hold in its head without drifting.

OpenSpec is closer in spirit, but it still reaches for a fuller spec framework. Crabyard takes a narrower bet. Most teams do not need more lifecycle concepts. They need fewer moving parts, stronger execution truth, and a way to keep accepted product knowledge from dissolving back into chat history.

So the pitch is straightforward: if you want a system that is easier to keep in context, easier to evolve with the project, and more likely to make the repo stronger over time, Crabyard is intentionally built as the smaller layer.

## Workflow

The workflow is short on purpose. It is meant to be easy to remember and easy to re-enter after context has gone stale.

```text
research -> explore -> plan -> review -> apply -> review -> verify -> sync -> verify -> archive -> learn/refresh
```

- `AGENTS.md` is the canonical repo-instruction file.
- accepted truth lives in `crabyard/specs/`
- in-flight accepted-truth edits live in `crabyard/changes/<slug>/specs/`
- durable implementation and debugging knowledge lives in `crabyard/knowledge/`

## What Gets Added To A Repo

After `init`, the repo gains a small amount of structure:

```text
<repo>/
  AGENTS.md
  .agents/skills/
    crabyard-research/
    crabyard-explore/
    crabyard-plan/
    crabyard-apply/
    crabyard-review/
    crabyard-archive/
    crabyard-debug/
    crabyard-learn/
    crabyard-refresh/
  crabyard/
    manifest.yaml
    project.md
    TASK_EXECUTION_FORMAT.md
    specs/
    changes/
    knowledge/
      index.md
```

## What A Change Looks Like

Each in-flight change lives in its own folder:

```text
crabyard/changes/<slug>/
  proposal.md
  design.md
  tasks.md
  execution.yaml
  specs/
  review.md
```

- `review.md` is optional.
- `execution.yaml` is required.
- `specs/` is the staged source for accepted-spec updates.

## What Crabyard Checks

The rule here is straightforward: `execution.yaml` cannot merely look plausible. It has to be structurally valid, and it has to line up with the `tasks.md` that a human would actually read. Otherwise the execution frontier is not worth trusting.

Crabyard parses `execution.yaml` with a real YAML parser and validates it against a schema.

It rejects:

- inline shape violations
- unknown `depends_on`
- dependency cycles
- duplicate unit ids
- duplicate unit titles
- missing `parallel`, `writes`, or `verify`
- overlapping `writes` for concurrently eligible `parallel: true` units unless every conflicting unit opts out with `allow_parallel_write_overlap: true`
- mismatches between top-level `##` sections in `tasks.md` and units in `execution.yaml`

`tasks.md` and `execution.yaml` must match one-for-one and in order.

`writes` uses ownership semantics:

- exact path: `src/execution.ts`
- subtree: `src/` or `src/**`
- glob: `src/**/*.ts`, `docs/{api,guide}.md`, `src/*/index.ts`

Overlap checks are segment-aware, so `src/*.ts` and `src/*.md` can run in parallel while `src/` still blocks any nested file ownership.

`verify` now accepts typed specs as well as legacy string shorthand:

- command: `kind`, `run` or `argv`, optional `cwd`, `timeout_ms`, `expect_exit_code`
- artifact: `kind`, `path`, optional `state`

Legacy `verify: [pnpm test]` remains valid and normalizes to a command check.

## The Commands That Actually Matter

The CLI is intentionally small. Most of the time, agents only need a handful of commands, and everything else is there to support that loop:

- `crabyard validate` to reject broken repo or change structure
- `crabyard status --json` to inspect repo state, change state, frontier, and verification summary
- `crabyard verify` to enforce deterministic closure gates
- `crabyard sync` to stage accepted-truth updates into canonical specs
- `crabyard archive` to close only verified and sync-coherent changes

That split is deliberate: skills stay thin, and the CLI remains the source of truth.

## How It Fits Into A Real Session

The easiest way to think about Crabyard is as shared working memory that sits next to your normal agent chat. You still talk to Codex or OpenCode the same way. The difference is that the repo now has a clean place for the plan, the frontier, and the closure rules.

Typical setup:

```text
1. You ask Codex/OpenCode for a feature or fix
2. The agent creates or updates crabyard/changes/<slug>/
3. The agent reads tasks.md + execution.yaml instead of guessing execution order
4. The agent uses status --json to decide what is ready now
5. The agent implements, reviews, verifies, syncs, and archives against explicit gates
```

A practical interaction loop looks like this:

```text
You: add OAuth login
  |
  v
Agent:
  - creates change bundle
  - writes proposal/design/tasks/execution
  - checks status --json
  - executes only ready units
  - re-checks status after each step
  - closes with verify/sync/archive
```

You do not need to think about Crabyard internals every day. What matters is that the repo has a much cleaner way to say how work should move.

## CLI Commands

The command surface stays small on purpose. Most of the time you will bounce between `status`, `verify`, `sync`, and `archive`, while `init` and `validate` do the setup and guardrail work.

- `init`: set up Crabyard files in a repo
- `install`: alias for `init`
- `list`: show available changes in the repo
- `show`: print one change bundle for inspection
- `validate`: check repo or change structure before work continues
- `status`: inspect repo state, change state, and the current frontier
- `verify`: enforce closure gates for a change
- `sync`: copy accepted-spec updates into canonical specs
- `archive`: close a verified, sync-coherent change

### `verify <change>`

Think of `verify` as a closure gate, not a task runner. It validates the change bundle, checks that `execution.yaml` is trustworthy, and fails if `tasks.md` still has unchecked items.

It does not execute arbitrary shell commands from the `verify` arrays in `execution.yaml`.

### `status [change]`

This is usually the command an agent reads the most. It is also read-only.

- `status` with no change summarizes repo validity, counts, and active change states
- `status <change>` summarizes task completion, ready units, blocked units, verification gaps, sync readiness, and the current execution frontier
- `--json` returns machine-readable status for agent tooling
- `status --json` now includes `frontier.readyUnits`, `frontier.blockedUnits`, and `verification.summary`

Example:

```bash
crabyard status add-auth --repo /absolute/path/to/repo --json
```

Typical JSON fields:

- `state`
- `units.items`
- `frontier.readyUnits`
- `frontier.blockedUnits`
- `verification.summary`
- `sync.pending`

### `sync <change>`

`sync` does one thing: it moves accepted-spec updates from:

```text
crabyard/changes/<slug>/specs/
```

to:

```text
crabyard/specs/
```

The behavior is intentionally conservative:

- the change must already pass `crabyard verify <change>`
- files staged under the change are copied or overwritten into accepted specs
- files absent from the change are left untouched in accepted specs
- file order is deterministic

### `archive <change>`

`archive` is not just a rename. It only closes a change when the repo is in a coherent state.

It fails unless:

- `verify` passes
- staged spec sync is coherent

The intended closure sequence is:

1. `crabyard verify <change>`
2. `crabyard sync <change>` if needed
3. `crabyard verify <change>`
4. `crabyard archive <change>`

## Built-In Skills

Crabyard installs a small set of repo-local skills under `.agents/skills/`. That is deliberate. You should be able to clone a repo, run `init`, and hand the agent the same small toolkit every time instead of depending on someone's global setup.

- `crabyard-research`
- `crabyard-explore`
- `crabyard-plan`
- `crabyard-apply`
- `crabyard-review`
- `crabyard-archive`
- `crabyard-debug`
- `crabyard-learn`
- `crabyard-refresh`

These skills only live inside the repo. Knowledge retrieval is treated as part of the workflow, not as an afterthought.

- `crabyard-research` searches `crabyard/knowledge/index.md`, `crabyard/knowledge/`, and relevant specs for the strongest prior learnings
- `crabyard-explore`, `crabyard-plan`, and `crabyard-review` now begin with an explicit retrieval pass
- retrieved knowledge informs decisions, but does not override accepted truth in `crabyard/specs/`
- `crabyard-review` can run both before apply to stress-test the plan and after apply to review the implementation

The reusable review layer lives in `crabyard-review` and looks at:

- code
- proposal
- design
- tasks
- execution plan
- relevant specs

It reports prioritized findings as `P1 / P2 / P3` and can write `crabyard/changes/<slug>/review.md`.

## How Knowledge Stays Useful

Crabyard keeps implementation and debugging notes in `crabyard/knowledge/`, but the goal is not note-taking for its own sake. The goal is to make the next piece of work easier than the last one.

- `crabyard-research` returns the strongest 1-3 prior learnings before planning, review, or debugging
- `crabyard-learn` checks overlap before creating a note and updates `knowledge/index.md`
- `crabyard-refresh` supports targeted refresh, consolidation, replacement, and stale marking
- `knowledge/index.md` stays retrieval-friendly and canonical

## Install

Install the published CLI:

```bash
npm install -g crabyard
```

If you would rather not install it globally, use:

```bash
npx crabyard@latest --help
```

## Getting Started

Once `crabyard` is available on your PATH, start with:

```bash
crabyard init /absolute/path/to/repo
crabyard validate --repo /absolute/path/to/repo
crabyard status --repo /absolute/path/to/repo
crabyard status add-auth --repo /absolute/path/to/repo --json
crabyard verify add-auth --repo /absolute/path/to/repo
crabyard sync add-auth --repo /absolute/path/to/repo
crabyard archive add-auth --repo /absolute/path/to/repo
```

A normal first loop looks like this:

1. `crabyard init /absolute/path/to/repo`
2. ask Codex/OpenCode to create `crabyard/changes/<slug>/`
3. let the agent write `proposal.md`, `design.md`, `tasks.md`, `execution.yaml`
4. run `crabyard validate change <slug> --repo /absolute/path/to/repo`
5. let the agent use `crabyard status <slug> --repo /absolute/path/to/repo --json`
6. implement from the ready frontier
7. run `verify`, `sync`, `verify`, `archive`

If you prefer `npx`, replace `crabyard` in the examples above with `npx crabyard@latest`.
