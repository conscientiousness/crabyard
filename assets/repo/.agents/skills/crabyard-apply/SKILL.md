---
name: crabyard-apply
description: Apply a planned Crabyard change using `execution.yaml` as the scheduling source of truth. Default to serial execution. Parallelize only when ready units are independently verifiable and have disjoint `writes`. Use only when the user explicitly invokes `crabyard-apply` or asks for the Crabyard apply workflow.
---

Apply a planned Crabyard change by implementing its bundle safely and keeping scheduling truth aligned with integrated progress.

## Read first

1. `AGENTS.md`
2. `crabyard/manifest.yaml`
3. `crabyard/project.md`
4. `crabyard/changes/<slug>/proposal.md`
5. `crabyard/changes/<slug>/design.md`
6. `crabyard/changes/<slug>/tasks.md`
7. `crabyard/changes/<slug>/execution.yaml`
8. relevant files under `crabyard/specs/`
9. relevant knowledge notes

## Workflow

1. Validate that the bundle is executable and that `execution.yaml` matches `tasks.md` before making changes.
2. Treat `execution.yaml` as the scheduling source of truth.
3. For the current ready unit, classify the work as:
   - behavior fix
   - behavior addition
   - internal refactor
   - structural migration
4. For the current ready unit, confirm:
   - what behavior must change
   - what behavior must remain stable
   - which files are inside the unit's intended write surface
5. Use task-aware bounded change discipline:
   - for a behavior fix, prefer the smallest effective change
   - for a behavior addition, implement the smallest sufficient change without speculative extension points
   - for an internal refactor, allow structural edits only when they directly serve the declared refactor goal
   - for a structural migration, allow broader coordinated edits only when sequencing, ownership, and verification remain explicit
6. Use `crabyard status <change> --json` to determine the current frontier. Execute only ready units. Re-check status after each integrated unit or batch.
7. Do not invent a different unit order or start blocked work early.
8. Default to serial execution.
9. A unit is eligible for parallel execution only when:
   - `parallel: true`
   - all `depends_on` are satisfied
   - `writes` ownership is disjoint from other concurrently ready units, unless the bundle explicitly opts out with `allow_parallel_write_overlap: true`
   - the unit's `verify` can run meaningfully on its own
10. Choose the execution strategy that preserves correctness in the current runtime:
   - serial execution in the current workspace
   - isolated concurrent execution for eligible units
11. If safe isolated parallel execution is unavailable, fall back to serial execution.
12. When running units in parallel, keep each unit within its declared `writes` ownership. Do not rely on hidden cross-unit coordination.
13. The apply stage owns integration. Integrate completed work before leaving it. The review stage inspects the integrated result and does not reconcile parallel implementation branches.
14. Do not mix unrelated cleanup, broad renames, or incidental rewrites into the current unit.
15. Run the relevant unit-level verification before treating a unit as done. Use `crabyard check <change>` when you want the normalized `verify` metadata to execute directly instead of only inspecting closure gates.
16. Before marking a unit complete, re-check that:
   - every changed file belongs to the unit's intended scope
   - each diff block is justified by the unit goal
   - accepted behavior remains stable unless the task explicitly called for behavior change
17. Mark task progress only after the work is integrated and verified. Keep `tasks.md` checkboxes aligned with integrated progress rather than in-flight work.
18. Record notable out-of-scope findings as follow-ups instead of silently expanding the unit.
19. Stage accepted-truth edits in `crabyard/changes/<slug>/specs/` instead of mutating `crabyard/specs/` directly.
20. Stop when the implemented change is integrated, verified at the unit level, and ready for review. If work remains blocked or ambiguous, stop and report the blocker instead of guessing.

## Guardrails

- Do not ignore a contradictory or invalid `execution.yaml`.
- Do not equate better-looking code with required work.
- Do not apply blanket minimal-diff thinking to refactor or migration tasks; apply bounded change discipline instead.
- Do not widen a unit's scope just because neighboring code is awkward.
- Do not parallelize concurrent writers that rely on hidden coordination.
- Do not treat speculative, partially integrated, or unverified work as complete.
- Do not archive during apply.
- Do not sync accepted specs during apply unless the user explicitly asks to leave apply mode.
