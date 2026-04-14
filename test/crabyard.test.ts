import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/crabyard.js";
import { PACKAGE_VERSION, formatCliLabelValue, formatCliText } from "../src/shared.js";

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

test("inline-list execution.yaml syntax validates", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "inline-list", {
    tasks: buildTasks(["Parser And Validation", "Final Integration"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts]
    verify: [pnpm test]
  - id: T2
    title: Final Integration
    parallel: false
    depends_on: [T1]
    writes: [README.md]
    verify: [pnpm build]
`,
  });

  const result = await run(repoPath, ["validate", "change", "inline-list", "--repo", repoPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /validation passed/i);
});

test("cli color helpers respect FORCE_COLOR and NO_COLOR", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  try {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";

    assert.match(formatCliText("ok", "success"), /\u001b\[/);
    assert.match(formatCliLabelValue("Repo", "/tmp/example", { valueTone: "accent" }), /\u001b\[/);

    process.env.NO_COLOR = "1";
    assert.equal(formatCliText("ok", "success"), "ok");
    assert.equal(formatCliLabelValue("Repo", "/tmp/example", { valueTone: "accent" }), "Repo: /tmp/example");
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }
});

test("version command prints the installed version", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-version-"));

  const commandResult = await run(repoPath, ["version"]);
  assert.equal(commandResult.code, 0, commandResult.stderr);
  assert.equal(commandResult.stdout, PACKAGE_VERSION);

  const flagResult = await run(repoPath, ["--version"]);
  assert.equal(flagResult.code, 0, flagResult.stderr);
  assert.equal(flagResult.stdout, PACKAGE_VERSION);
});

test("unknown depends_on fails validation", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "bad-dependency", {
    tasks: buildTasks(["Parser And Validation"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: [T9]
    writes: [src/execution.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "bad-dependency", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown depends_on target: T9/);
});

test("dependency cycles fail validation", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "cycle", {
    tasks: buildTasks(["Parser And Validation", "Lifecycle Commands"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: [T2]
    writes: [src/execution.ts]
    verify: [pnpm test]
  - id: T2
    title: Lifecycle Commands
    parallel: false
    depends_on: [T1]
    writes: [src/crabyard.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "cycle", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /dependency cycle/i);
});

test("duplicate unit ids fail validation", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "duplicate-id", {
    tasks: buildTasks(["Parser And Validation", "Lifecycle Commands"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts]
    verify: [pnpm test]
  - id: T1
    title: Lifecycle Commands
    parallel: false
    depends_on: []
    writes: [src/crabyard.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "duplicate-id", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /duplicate unit id: T1/);
});

test("overlapping parallel writes fail validation", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "parallel-conflict", {
    tasks: buildTasks(["Parser And Validation", "Lifecycle Commands"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: true
    depends_on: []
    writes: [src/**]
    verify: [pnpm test]
  - id: T2
    title: Lifecycle Commands
    parallel: true
    depends_on: []
    writes: [src/crabyard.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "parallel-conflict", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /overlapping writes/i);
});

test("segment-aware glob ownership avoids false overlap", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "glob-no-conflict", {
    tasks: buildTasks(["TypeScript Outputs", "Markdown Outputs"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: TypeScript Outputs
    parallel: true
    depends_on: []
    writes: [src/*.ts]
    verify: [pnpm test]
  - id: T2
    title: Markdown Outputs
    parallel: true
    depends_on: []
    writes: [src/*.md]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "glob-no-conflict", "--repo", repoPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /validation passed/i);
});

test("segment-aware glob ownership still catches recursive overlap", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "glob-conflict", {
    tasks: buildTasks(["Direct Index", "Recursive Index"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Direct Index
    parallel: true
    depends_on: []
    writes: [src/*/index.ts]
    verify: [pnpm test]
  - id: T2
    title: Recursive Index
    parallel: true
    depends_on: []
    writes: [src/**/index.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "glob-conflict", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /overlapping writes/i);
});

test("trailing slash write ownership claims a subtree", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "trailing-slash-conflict", {
    tasks: buildTasks(["Directory Ownership", "File Ownership"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Directory Ownership
    parallel: true
    depends_on: []
    writes: [src/]
    verify: [pnpm test]
  - id: T2
    title: File Ownership
    parallel: true
    depends_on: []
    writes: [src/crabyard.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["validate", "change", "trailing-slash-conflict", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /overlapping writes/i);
});

test("missing parallel, writes, or verify fields fail validation", async () => {
  const cases = [
    {
      changeName: "missing-parallel",
      execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    depends_on: []
    writes: [src/execution.ts]
    verify: [pnpm test]
`,
      pattern: /missing parallel/i,
    },
    {
      changeName: "missing-writes",
      execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    verify: [pnpm test]
`,
      pattern: /missing writes/i,
    },
    {
      changeName: "missing-verify",
      execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts]
`,
      pattern: /missing verify/i,
    },
  ];

  for (const testCase of cases) {
    const repoPath = await createInitializedRepo();
    await writeChange(repoPath, testCase.changeName, {
      tasks: buildTasks(["Parser And Validation"]),
      execution: testCase.execution,
    });

    const result = await run(repoPath, ["validate", "change", testCase.changeName, "--repo", repoPath]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, testCase.pattern);
  }
});

test("typed verify specs validate and normalize into status output", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "typed-verify", {
    tasks: buildTasks(["Verification Metadata"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Verification Metadata
    parallel: false
    depends_on: []
    writes: [dist/index.js]
    verify:
      - kind: command
        argv: [pnpm, build]
        cwd: packages/app
        timeout_ms: 120000
      - kind: artifact
        path: dist/index.js
        state: exists
`,
  });

  const validateResult = await run(repoPath, ["validate", "change", "typed-verify", "--repo", repoPath]);
  assert.equal(validateResult.code, 0, validateResult.stderr);

  const statusResult = await run(repoPath, ["status", "typed-verify", "--repo", repoPath, "--json"]);
  assert.equal(statusResult.code, 0, statusResult.stderr);
  const status = parseJson(statusResult.stdout);
  assert.deepEqual(status.units.items[0].verify, [
    {
      kind: "command",
      argv: ["pnpm", "build"],
      cwd: "packages/app",
      timeoutMs: 120000,
      expectExitCode: 0,
    },
    {
      kind: "artifact",
      path: "dist/index.js",
      state: "exists",
    },
  ]);
  assert.deepEqual(status.verification.summary, {
    totalChecks: 2,
    commandChecks: 1,
    artifactChecks: 1,
    readyUnitChecks: 0,
    readyCommandChecks: 0,
    readyArtifactChecks: 0,
  });
});

test("invalid typed verify spec fails validation with a clear error", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "bad-verify-spec", {
    tasks: buildTasks(["Verification Metadata"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Verification Metadata
    parallel: false
    depends_on: []
    writes: [dist/index.js]
    verify:
      - kind: command
        cwd: packages/app
`,
  });

  const result = await run(repoPath, ["validate", "change", "bad-verify-spec", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must define exactly one of run or argv/i);
});

test("migrate openspec copies specs, change bundles, and archive history", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-openspec-migrate-"));

  await mkdir(join(repoPath, "openspec"), { recursive: true });
  await writeFile(join(repoPath, "openspec", "config.yaml"), "schema: spec-driven\n", "utf8");
  await writeOpenSpecSpec(repoPath, "cli-archive/spec.md", "# CLI Archive\n");
  await mkdir(join(repoPath, "openspec", "changes"), { recursive: true });
  await writeFile(join(repoPath, "openspec", "changes", "IMPLEMENTATION_ORDER.md"), "# Order\n", "utf8");
  await writeOpenSpecChange(repoPath, "ship-auth", {
    proposal: "# Proposal\n",
    tasks: `# Implementation Tasks

## 1. Build Auth Module
- [ ] Create \`src/auth.ts\`

## 2. Wire CLI
- [ ] Update \`src/index.ts\`
`,
    stagedSpecs: {
      "auth/spec.md": "# Auth Spec\n",
    },
    extraFiles: {
      "notes.md": "# Notes\n",
    },
  });
  await writeOpenSpecChange(repoPath, "2026-01-01-old-feature", {
    archived: true,
    proposal: "# Archived Proposal\n",
  });

  const result = await run(repoPath, ["migrate", "openspec", repoPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Imported 1 spec file\(s\), 1 active change\(s\), and 1 archived change\(s\)\./);
  assert.match(result.stdout, /Left in place for manual review:/);
  assert.match(result.stdout, /openspec\/config\.yaml/);

  await assertPathExists(join(repoPath, "crabyard", "manifest.yaml"));
  assert.equal(await readFile(join(repoPath, "crabyard", "specs", "cli-archive", "spec.md"), "utf8"), "# CLI Archive\n");
  assert.equal(await readFile(join(repoPath, "crabyard", "changes", "IMPLEMENTATION_ORDER.md"), "utf8"), "# Order\n");
  assert.equal(await readFile(join(repoPath, "crabyard", "changes", "ship-auth", "proposal.md"), "utf8"), "# Proposal\n");
  assert.match(
    await readFile(join(repoPath, "crabyard", "changes", "ship-auth", "design.md"), "utf8"),
    /did not include `design\.md`/i,
  );
  assert.equal(await readFile(join(repoPath, "crabyard", "changes", "ship-auth", "notes.md"), "utf8"), "# Notes\n");
  assert.equal(
    await readFile(join(repoPath, "crabyard", "changes", "ship-auth", "specs", "auth", "spec.md"), "utf8"),
    "# Auth Spec\n",
  );

  const execution = await readFile(join(repoPath, "crabyard", "changes", "ship-auth", "execution.yaml"), "utf8");
  assert.match(execution, /src\/auth\.ts/);
  assert.match(execution, /src\/index\.ts/);

  await assertPathExists(join(repoPath, "crabyard", "changes", "archive", "2026-01-01-old-feature", "tasks.md"));
  await assertPathExists(join(repoPath, "crabyard", "changes", "archive", "2026-01-01-old-feature", "execution.yaml"));
  await assertPathExists(join(repoPath, "openspec", "changes", "ship-auth", "proposal.md"));

  const validateResult = await run(repoPath, ["validate", "--repo", repoPath]);
  assert.equal(validateResult.code, 0, validateResult.stderr);
});

test("migrate openspec normalizes legacy task files and is idempotent", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-openspec-normalize-"));
  await writeOpenSpecChange(repoPath, "legacy-tasks", {
    proposal: "# Proposal\n",
    tasks: `# Legacy Tasks
- [ ] Review \`README.md\`
`,
  });

  const firstRun = await run(repoPath, ["migrate", "openspec", repoPath]);
  assert.equal(firstRun.code, 0, firstRun.stderr);

  const secondRun = await run(repoPath, ["migrate", "openspec", repoPath]);
  assert.equal(secondRun.code, 0, secondRun.stderr);

  assert.equal(
    await readFile(join(repoPath, "crabyard", "changes", "legacy-tasks", "tasks.openspec.md"), "utf8"),
    "# Legacy Tasks\n- [ ] Review `README.md`\n",
  );
  assert.match(
    await readFile(join(repoPath, "crabyard", "changes", "legacy-tasks", "tasks.md"), "utf8"),
    /Normalize Migrated OpenSpec Tasks/,
  );

  const execution = await readFile(join(repoPath, "crabyard", "changes", "legacy-tasks", "execution.yaml"), "utf8");
  assert.match(execution, /tasks\.openspec\.md/);

  const validateResult = await run(repoPath, ["validate", "change", "legacy-tasks", "--repo", repoPath]);
  assert.equal(validateResult.code, 0, validateResult.stderr);
});

test("migrate openspec requires an openspec directory", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-openspec-missing-"));
  const result = await run(repoPath, ["migrate", "openspec", repoPath]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing OpenSpec root/i);
});

test("init creates the expected structure", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-init-"));
  const result = await run(repoPath, ["init", repoPath]);

  assert.equal(result.code, 0, result.stderr);
  await assertPathExists(join(repoPath, "AGENTS.md"));
  await assertPathExists(join(repoPath, "crabyard", "manifest.yaml"));
  await assertPathExists(join(repoPath, "crabyard", "project.md"));
  await assertPathExists(join(repoPath, "crabyard", "TASK_EXECUTION_FORMAT.md"));
  await assertPathExists(join(repoPath, "crabyard", "specs", "README.md"));
  await assertPathExists(join(repoPath, "crabyard", "changes", "README.md"));
  await assertPathExists(join(repoPath, "crabyard", "knowledge", "index.md"));
  await assertPathExists(join(repoPath, ".agents", "skills", "crabyard-research", "SKILL.md"));
  await assertPathExists(join(repoPath, ".agents", "skills", "crabyard-review", "SKILL.md"));
  await assertPathExists(join(repoPath, ".agents", "skills", "crabyard-learn", "SKILL.md"));
  await assertPathExists(join(repoPath, ".agents", "skills", "crabyard-refresh", "SKILL.md"));
  await assertPathMissing(join(repoPath, ".codex", "skills", "crabyard-research", "SKILL.md"));
  await assertPathMissing(join(repoPath, ".codex", "skills", "crabyard-review", "SKILL.md"));
});

test("init rejects removed global compatibility flags", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-init-no-compat-"));
  const result = await run(repoPath, ["init", repoPath, "--skip-global"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown flag: --skip-global/);
});

test("update refreshes managed repo assets and preserves manifest metadata", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-update-"));
  const initResult = await run(repoPath, [
    "init",
    repoPath,
    "--primary-docs",
    "README.md,docs/guide.md",
    "--tags",
    "alpha,beta",
  ]);
  assert.equal(initResult.code, 0, initResult.stderr);

  const targetSkillPath = join(repoPath, ".agents", "skills", "crabyard-apply", "SKILL.md");
  const projectPath = join(repoPath, "crabyard", "project.md");
  const knowledgeIndexPath = join(repoPath, "crabyard", "knowledge", "index.md");
  const taskFormatPath = join(repoPath, "crabyard", "TASK_EXECUTION_FORMAT.md");
  const specsReadmePath = join(repoPath, "crabyard", "specs", "README.md");
  const changesReadmePath = join(repoPath, "crabyard", "changes", "README.md");
  await writeFile(targetSkillPath, "# stale template\n", "utf8");
  await writeFile(projectPath, "# Repo Context\n\nKeep this custom context.\n", "utf8");
  await writeFile(knowledgeIndexPath, "# Knowledge Index\n\n- [custom](./custom.md) - tags: `test`; summary: keep me.\n", "utf8");
  await writeFile(taskFormatPath, "# Custom Task Format\n", "utf8");
  await writeFile(specsReadmePath, "# Custom Specs Guide\n", "utf8");
  await writeFile(changesReadmePath, "# Custom Changes Guide\n", "utf8");

  const updateResult = await run(repoPath, ["update", repoPath]);
  assert.equal(updateResult.code, 0, updateResult.stderr);
  assert.match(updateResult.stdout, /Update complete\./);

  const expectedSkill = await readFile(new URL("../assets/repo/.agents/skills/crabyard-apply/SKILL.md", import.meta.url), "utf8");
  assert.equal(await readFile(targetSkillPath, "utf8"), expectedSkill);
  assert.equal(await readFile(projectPath, "utf8"), "# Repo Context\n\nKeep this custom context.\n");
  assert.equal(
    await readFile(knowledgeIndexPath, "utf8"),
    "# Knowledge Index\n\n- [custom](./custom.md) - tags: `test`; summary: keep me.\n",
  );
  assert.equal(await readFile(taskFormatPath, "utf8"), "# Custom Task Format\n");
  assert.equal(await readFile(specsReadmePath, "utf8"), "# Custom Specs Guide\n");
  assert.equal(await readFile(changesReadmePath, "utf8"), "# Custom Changes Guide\n");
  assert.equal(await pathExistsOnDisk(join(repoPath, ".crabyard", "backups")), false);

  const manifest = await readFile(join(repoPath, "crabyard", "manifest.yaml"), "utf8");
  assert.match(manifest, /source_docs:\n  - README\.md\n  - docs\/guide\.md\n/);
  assert.match(manifest, /default_tags:\n  - alpha\n  - beta\n/);
});

test("update preserves custom manifest fields and custom managed paths", async () => {
  const repoPath = await createInitializedRepo();
  const manifestPath = join(repoPath, "crabyard", "manifest.yaml");

  await writeFile(
    manifestPath,
    `# Managed by crabyard
version: 1
root: custom-yard
project_file: custom-yard/project-context.md
task_format_file: custom-yard/TASKS.md
instructions_file: AGENTS.md
specs_root: custom-yard/specs-v2
changes_root: custom-yard/changes-v2
knowledge:
  root: custom-yard/knowledge-base
  index: custom-yard/knowledge-base/index.md
skills:
  canonical_root: .agents/custom-skills
source_docs:
  - README.md
workflow:
  - inspect
  - implement
  - verify
refresh_scope:
  - custom-yard/knowledge-base
write_policy:
  forbid_paths:
    - CLAUDE.md
  mutate_agents_only_when_routing_changes: false
default_tags:
  - custom-tag
notes:
  - Keep this custom note.
custom_field: keep-me
`,
    "utf8",
  );

  const result = await run(repoPath, ["update", repoPath]);
  assert.equal(result.code, 0, result.stderr);

  const updatedManifest = await readFile(manifestPath, "utf8");
  assert.match(updatedManifest, /root: custom-yard/);
  assert.match(updatedManifest, /project_file: custom-yard\/project-context\.md/);
  assert.match(updatedManifest, /task_format_file: custom-yard\/TASKS\.md/);
  assert.match(updatedManifest, /specs_root: custom-yard\/specs-v2/);
  assert.match(updatedManifest, /changes_root: custom-yard\/changes-v2/);
  assert.match(updatedManifest, /root: custom-yard\/knowledge-base/);
  assert.match(updatedManifest, /index: custom-yard\/knowledge-base\/index\.md/);
  assert.match(updatedManifest, /canonical_root: \.agents\/custom-skills/);
  assert.match(updatedManifest, /custom_field: keep-me/);
  assert.match(updatedManifest, /workflow:\n  - inspect\n  - implement\n  - verify\n/);
  assert.match(updatedManifest, /refresh_scope:\n  - custom-yard\/knowledge-base\n/);
  assert.match(updatedManifest, /mutate_agents_only_when_routing_changes: false/);
  assert.match(updatedManifest, /notes:\n  - Keep this custom note\.\n/);

  const customProjectPath = join(repoPath, "custom-yard", "project-context.md");
  const customIndexPath = join(repoPath, "custom-yard", "knowledge-base", "index.md");
  const customTaskPath = join(repoPath, "custom-yard", "TASKS.md");
  await writeFile(customProjectPath, "# Preserved Project Context\n", "utf8");
  await writeFile(customIndexPath, "# Preserved Knowledge Index\n", "utf8");
  await writeFile(customTaskPath, "# Preserved Task Format\n", "utf8");

  const secondResult = await run(repoPath, ["update", repoPath]);
  assert.equal(secondResult.code, 0, secondResult.stderr);

  await assertPathExists(join(repoPath, "custom-yard", "project-context.md"));
  await assertPathExists(join(repoPath, "custom-yard", "TASKS.md"));
  await assertPathExists(join(repoPath, "custom-yard", "specs-v2", "README.md"));
  await assertPathExists(join(repoPath, "custom-yard", "changes-v2", "README.md"));
  await assertPathExists(join(repoPath, "custom-yard", "knowledge-base", "index.md"));
  await assertPathExists(join(repoPath, ".agents", "custom-skills", "crabyard-apply", "SKILL.md"));
  assert.equal(await readFile(customProjectPath, "utf8"), "# Preserved Project Context\n");
  assert.equal(await readFile(customIndexPath, "utf8"), "# Preserved Knowledge Index\n");
  assert.equal(await readFile(customTaskPath, "utf8"), "# Preserved Task Format\n");

  const agentsContent = await readFile(join(repoPath, "AGENTS.md"), "utf8");
  assert.match(agentsContent, /Use `custom-yard\/project-context\.md` for stable repo-wide context\./);
  assert.match(agentsContent, /Keep accepted product behavior, contracts, and invariants in `custom-yard\/specs-v2\/`\./);
  assert.match(agentsContent, /Keep in-flight accepted-truth edits in `custom-yard\/changes-v2\/<slug>\/specs\/`\./);
  assert.match(agentsContent, /Keep durable debugging, implementation, and operations notes in `custom-yard\/knowledge-base\/`\./);
  assert.match(agentsContent, /Use repo-local skills from `\.agents\/custom-skills\/` only\./);
  assert.match(agentsContent, /Prefer the workflow `inspect -> implement -> verify`\./);
});

test("update restores missing repo-authored scaffold files without overwriting existing ones", async () => {
  const repoPath = await createInitializedRepo();
  const projectPath = join(repoPath, "crabyard", "project.md");
  const knowledgeIndexPath = join(repoPath, "crabyard", "knowledge", "index.md");
  const taskFormatPath = join(repoPath, "crabyard", "TASK_EXECUTION_FORMAT.md");

  await rm(projectPath, { force: true });
  await rm(knowledgeIndexPath, { force: true });
  await rm(taskFormatPath, { force: true });

  const result = await run(repoPath, ["update", repoPath]);
  assert.equal(result.code, 0, result.stderr);

  assert.match(await readFile(projectPath, "utf8"), /# Project Context/);
  assert.match(await readFile(knowledgeIndexPath, "utf8"), /# Knowledge Index/);
  assert.match(await readFile(taskFormatPath, "utf8"), /# Task Execution Format/);
});

test("update rejects --skip-repo", async () => {
  const repoPath = await createInitializedRepo();
  const result = await run(repoPath, ["update", repoPath, "--skip-repo"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not support --skip-repo/i);
});

test("update replaces managed assets idempotently instead of appending", async () => {
  const repoPath = await createInitializedRepo();
  const targetSkillPath = join(repoPath, ".agents", "skills", "crabyard-apply", "SKILL.md");
  const agentsPath = join(repoPath, "AGENTS.md");

  await writeFile(targetSkillPath, "# stale template\n# stale template\n", "utf8");
  await writeFile(
    agentsPath,
    `# AI development guide

<!-- crabyard:memory:start -->
stale block
<!-- crabyard:memory:end -->
`,
    "utf8",
  );

  const firstUpdate = await run(repoPath, ["update", repoPath]);
  assert.equal(firstUpdate.code, 0, firstUpdate.stderr);

  const secondUpdate = await run(repoPath, ["update", repoPath]);
  assert.equal(secondUpdate.code, 0, secondUpdate.stderr);

  const expectedSkill = await readFile(new URL("../assets/repo/.agents/skills/crabyard-apply/SKILL.md", import.meta.url), "utf8");
  assert.equal(await readFile(targetSkillPath, "utf8"), expectedSkill);

  const agentsContent = await readFile(agentsPath, "utf8");
  assert.equal((agentsContent.match(/<!-- crabyard:memory:start -->/g) ?? []).length, 1);
  assert.equal((agentsContent.match(/<!-- crabyard:memory:end -->/g) ?? []).length, 1);
  assert.doesNotMatch(agentsContent, /stale block/);
});

test("update creates backups only when --backup is requested", async () => {
  const repoPath = await createInitializedRepo();
  const targetSkillPath = join(repoPath, ".agents", "skills", "crabyard-apply", "SKILL.md");
  await writeFile(targetSkillPath, "# stale template\n", "utf8");

  const result = await run(repoPath, ["update", repoPath, "--backup"]);
  assert.equal(result.code, 0, result.stderr);

  const backupsRoot = join(repoPath, ".crabyard", "backups");
  assert.equal(await pathExistsOnDisk(backupsRoot), true);

  const entries = await readdir(backupsRoot);
  assert.equal(entries.length, 1);
  assert.equal(
    await pathExistsOnDisk(join(backupsRoot, entries[0], ".agents", "skills", "crabyard-apply", "SKILL.md")),
    true,
  );
});

test("manifest paths must stay inside the repo root", async () => {
  const repoPath = await createInitializedRepo();
  const manifestPath = join(repoPath, "crabyard", "manifest.yaml");
  const manifest = await readFile(manifestPath, "utf8");

  await writeFile(manifestPath, manifest.replace("specs_root: crabyard/specs", "specs_root: /tmp/crabyard-specs"), "utf8");

  const result = await run(repoPath, ["validate", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Manifest path must stay inside the repo root/i);
});

test("sync is deterministic", async () => {
  const repoPath = await createInitializedRepo();
  await writeFile(join(repoPath, "crabyard", "specs", "api.md"), "# Old\n", "utf8");
  await writeChange(repoPath, "sync-me", {
    tasks: buildTasks(["Parser And Validation"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [crabyard/specs/api.md]
    verify: [pnpm test]
`,
    stagedSpecs: {
      "api.md": "# New\n",
      "new.md": "# Added\n",
    },
  });

  const firstSync = await run(repoPath, ["sync", "sync-me", "--repo", repoPath]);
  assert.equal(firstSync.code, 0, firstSync.stderr);
  assert.match(firstSync.stdout, /Synced 2 spec file/);
  assert.equal(await readFile(join(repoPath, "crabyard", "specs", "api.md"), "utf8"), "# New\n");
  assert.equal(await readFile(join(repoPath, "crabyard", "specs", "new.md"), "utf8"), "# Added\n");

  const secondSync = await run(repoPath, ["sync", "sync-me", "--repo", repoPath]);
  assert.equal(secondSync.code, 0, secondSync.stderr);
  assert.match(secondSync.stdout, /already sync-coherent/i);
});

test("sync refuses unverified changes", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "premature-sync", {
    tasks: buildTasks(["Parser And Validation"], false),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [crabyard/specs/api.md]
    verify: [pnpm test]
`,
    stagedSpecs: {
      "api.md": "# New\n",
    },
  });

  const result = await run(repoPath, ["sync", "premature-sync", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /failed verification/i);
  await assertPathMissing(join(repoPath, "crabyard", "specs", "api.md"));
});

test("archive refuses unverified changes", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "unverified", {
    tasks: buildTasks(["Parser And Validation"], false),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts]
    verify: [pnpm test]
`,
  });

  const result = await run(repoPath, ["archive", "unverified", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /failed verification/i);
});

test("archive refuses unsynced changes", async () => {
  const repoPath = await createInitializedRepo();
  await writeFile(join(repoPath, "crabyard", "specs", "api.md"), "# Old\n", "utf8");
  await writeChange(repoPath, "unsynced", {
    tasks: buildTasks(["Parser And Validation"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [crabyard/specs/api.md]
    verify: [pnpm test]
`,
    stagedSpecs: {
      "api.md": "# New\n",
    },
  });

  const result = await run(repoPath, ["archive", "unsynced", "--repo", repoPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Pending spec sync/i);
});

test("status reports ready and blocked units for an in-progress change", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "frontier", {
    tasks: `## 1. Parser And Validation
- [x] Complete parser and validation

## 2. Lifecycle Commands
- [ ] Add verify and sync

## 3. Final Integration
- [ ] Re-run build and tests
`,
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [src/execution.ts]
    verify: [pnpm test]
  - id: T2
    title: Lifecycle Commands
    parallel: false
    depends_on: [T1]
    writes: [src/crabyard.ts]
    verify: [pnpm test]
  - id: T3
    title: Final Integration
    parallel: false
    depends_on: [T2]
    writes: [README.md]
    verify: [pnpm build]
`,
  });

  const result = await run(repoPath, ["status", "frontier", "--repo", repoPath, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const status = parseJson(result.stdout);

  assert.equal(status.kind, "change-status");
  assert.equal(status.state, "in-progress");
  assert.equal(status.units.ready, 1);
  assert.equal(status.units.blocked, 1);
  assert.equal(status.tasks.completedSections, 1);
  assert.equal(status.verification.ready, false);
  assert.equal(status.verification.summary.totalChecks, 3);
  assert.equal(status.verification.summary.readyUnitChecks, 1);
  assert.deepEqual(status.frontier.readyUnits.map((unit: { id: string }) => unit.id), ["T2"]);
  assert.deepEqual(status.frontier.blockedUnits.map((unit: { id: string }) => unit.id), ["T3"]);
  assert.deepEqual(
    status.units.items.map((unit: { id: string; ready: boolean; blockedBy: string[] }) => ({
      id: unit.id,
      ready: unit.ready,
      blockedBy: unit.blockedBy,
    })),
    [
      { id: "T1", ready: false, blockedBy: [] },
      { id: "T2", ready: true, blockedBy: [] },
      { id: "T3", ready: false, blockedBy: ["T2"] },
    ],
  );
});

test("status transitions from ready-to-sync to ready-to-archive", async () => {
  const repoPath = await createInitializedRepo();
  await writeFile(join(repoPath, "crabyard", "specs", "api.md"), "# Old\n", "utf8");
  await writeChange(repoPath, "ship-it", {
    tasks: buildTasks(["Parser And Validation"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [crabyard/specs/api.md]
    verify: [pnpm test]
`,
    stagedSpecs: {
      "api.md": "# New\n",
    },
  });

  const beforeSync = await run(repoPath, ["status", "ship-it", "--repo", repoPath, "--json"]);
  assert.equal(beforeSync.code, 0, beforeSync.stderr);
  const pendingStatus = parseJson(beforeSync.stdout);
  assert.equal(pendingStatus.state, "ready-to-sync");
  assert.equal(pendingStatus.sync.pendingCount, 1);

  const syncResult = await run(repoPath, ["sync", "ship-it", "--repo", repoPath]);
  assert.equal(syncResult.code, 0, syncResult.stderr);

  const afterSync = await run(repoPath, ["status", "ship-it", "--repo", repoPath, "--json"]);
  assert.equal(afterSync.code, 0, afterSync.stderr);
  const coherentStatus = parseJson(afterSync.stdout);
  assert.equal(coherentStatus.state, "ready-to-archive");
  assert.equal(coherentStatus.sync.pendingCount, 0);
});

test("verify emits machine-readable json", async () => {
  const repoPath = await createInitializedRepo();
  await writeFile(join(repoPath, "crabyard", "specs", "api.md"), "# Old\n", "utf8");
  await writeChange(repoPath, "json-verify", {
    tasks: buildTasks(["Parser And Validation"]),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Parser And Validation
    parallel: false
    depends_on: []
    writes: [crabyard/specs/api.md]
    verify: [pnpm test]
`,
    stagedSpecs: {
      "api.md": "# New\n",
    },
  });

  const result = await run(repoPath, ["verify", "json-verify", "--repo", repoPath, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = parseJson(result.stdout);

  assert.equal(payload.kind, "verify");
  assert.equal(payload.ready, true);
  assert.equal(payload.sync.pendingCount, 1);
});

test("check executes command and artifact verify specs", async () => {
  const repoPath = await createInitializedRepo();
  await mkdir(join(repoPath, "dist"), { recursive: true });
  await writeFile(join(repoPath, "dist", "checked.js"), "export {};\n", "utf8");
  await writeChange(repoPath, "checked", {
    tasks: buildTasks(["Verification Metadata"], false),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Verification Metadata
    parallel: false
    depends_on: []
    writes: [dist/checked.js]
    verify:
      - kind: command
        run: node -e "process.exit(0)"
      - kind: artifact
        path: dist/checked.js
        state: exists
`,
  });

  const result = await run(repoPath, ["check", "checked", "--repo", repoPath, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = parseJson(result.stdout);

  assert.equal(payload.kind, "check");
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.checks, 2);
  assert.equal(payload.summary.failed, 0);
  assert.equal(payload.units[0].results[0].ok, true);
  assert.equal(payload.units[0].results[1].ok, true);
});

test("check reports failing verify checks without depending on task completion", async () => {
  const repoPath = await createInitializedRepo();
  await writeChange(repoPath, "failing-check", {
    tasks: buildTasks(["Verification Metadata"], false),
    execution: `version: 1
tasks_file: tasks.md
units:
  - id: T1
    title: Verification Metadata
    parallel: false
    depends_on: []
    writes: [dist/missing.js]
    verify:
      - kind: command
        run: node -e "process.exit(3)"
      - kind: artifact
        path: dist/missing.js
        state: exists
`,
  });

  const result = await run(repoPath, ["check", "failing-check", "--repo", repoPath, "--json"]);
  assert.equal(result.code, 1);
  const payload = parseJson(result.stdout);

  assert.equal(payload.kind, "check");
  assert.equal(payload.ok, false);
  assert.equal(payload.summary.failed, 2);
  assert.match(result.stderr, /Change check failed/i);
});

test("search prefers path matches and can include specs", async () => {
  const repoPath = await createInitializedRepo();
  await writeKnowledgeNote(repoPath, "oauth-notes.md", "# OAuth Notes\nToken exchange details.\n");
  await writeKnowledgeIndex(
    repoPath,
    "- [OAuth Notes](./oauth-notes.md) - tags: `oauth`; summary: compiled OAuth knowledge.\n",
  );
  await writeFile(join(repoPath, "crabyard", "specs", "auth.md"), "# Auth\nCallback exchange contract.\n", "utf8");

  const pathResult = await run(repoPath, ["search", "oauth-notes", "--repo", repoPath, "--json"]);
  assert.equal(pathResult.code, 0, pathResult.stderr);
  const pathPayload = parseJson(pathResult.stdout);
  assert.equal(pathPayload.results[0].path, "crabyard/knowledge/oauth-notes.md");
  assert.equal(pathPayload.results[0].reason, "path-exact");

  const specResult = await run(repoPath, ["search", "callback", "--repo", repoPath, "--json", "--include-specs"]);
  assert.equal(specResult.code, 0, specResult.stderr);
  const specPayload = parseJson(specResult.stdout);
  assert.equal(specPayload.results[0].kind, "spec");
  assert.equal(specPayload.results[0].path, "crabyard/specs/auth.md");
});

test("lint knowledge detects index gaps and invalid frontmatter paths", async () => {
  const repoPath = await createInitializedRepo();
  await writeKnowledgeNote(
    repoPath,
    "orphan.md",
    `---
paths:
  - src/missing.ts
---

# Orphan
`,
  );
  await writeKnowledgeNote(repoPath, "indexed.md", "# Indexed\n");
  await writeKnowledgeIndex(
    repoPath,
    [
      "- [Indexed](./indexed.md) - tags: `alpha`; summary: canonical note.",
      "- [Indexed Again](./indexed.md) - tags: `beta`; summary: duplicate canonical note.",
      "- [Missing](./missing.md) - tags: `ghost`; summary: missing target.",
    ].join("\n"),
  );

  const result = await run(repoPath, ["lint", "knowledge", "--repo", repoPath, "--json"]);
  assert.equal(result.code, 1);
  const payload = parseJson(result.stdout);
  const codes = payload.findings.map((finding: { code: string }) => finding.code).sort();

  assert.deepEqual(codes, [
    "frontmatter-path-missing",
    "index-duplicate-target",
    "index-target-missing",
    "note-missing-index",
  ]);
});

test("canonical repo-local skills live only under .agents", async () => {
  const repoPath = await createInitializedRepo();
  const canonicalSkill = await readFile(join(repoPath, ".agents", "skills", "crabyard-review", "SKILL.md"), "utf8");

  assert.match(canonicalSkill, /Prioritize as `P1`, `P2`, `P3`/);
  await assertPathMissing(join(repoPath, ".codex", "skills", "crabyard-review", "SKILL.md"));
});

test("explore, plan, and review skills embed retrieval before deeper work", async () => {
  const repoPath = await createInitializedRepo();
  const exploreSkill = await readFile(join(repoPath, ".agents", "skills", "crabyard-explore", "SKILL.md"), "utf8");
  const planSkill = await readFile(join(repoPath, ".agents", "skills", "crabyard-plan", "SKILL.md"), "utf8");
  const reviewSkill = await readFile(join(repoPath, ".agents", "skills", "crabyard-review", "SKILL.md"), "utf8");
  const manifest = await readFile(join(repoPath, "crabyard", "manifest.yaml"), "utf8");

  assert.match(exploreSkill, /retrieval pass/i);
  assert.match(exploreSkill, /strongest 1-3 prior learnings/i);
  assert.doesNotMatch(exploreSkill, /next verb/i);
  assert.match(exploreSkill, /next step in the workflow/i);
  assert.match(planSkill, /repo-local `crabyard-research` skill/i);
  assert.match(reviewSkill, /retrieved knowledge/i);
  assert.match(manifest, /\nworkflow:\n  - research\n/);
});

async function createInitializedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "crabyard-repo-"));
  const result = await run(repoPath, ["init", repoPath]);
  assert.equal(result.code, 0, result.stderr);
  return repoPath;
}

async function writeChange(
  repoPath: string,
  changeName: string,
  args: {
    tasks: string;
    execution: string;
    stagedSpecs?: Record<string, string>;
  },
) {
  const changeDir = join(repoPath, "crabyard", "changes", changeName);
  const specsDir = join(changeDir, "specs");
  await mkdir(specsDir, { recursive: true });
  await writeFile(join(changeDir, "proposal.md"), "# Proposal\n", "utf8");
  await writeFile(join(changeDir, "design.md"), "# Design\n", "utf8");
  await writeFile(join(changeDir, "tasks.md"), args.tasks, "utf8");
  await writeFile(join(changeDir, "execution.yaml"), args.execution, "utf8");

  for (const [relativePath, content] of Object.entries(args.stagedSpecs ?? {})) {
    const targetPath = join(specsDir, relativePath);
    await mkdir(join(targetPath, ".."), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }
}

async function writeOpenSpecSpec(repoPath: string, relativePath: string, content: string) {
  const targetPath = join(repoPath, "openspec", "specs", relativePath);
  await mkdir(join(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function writeOpenSpecChange(
  repoPath: string,
  changeName: string,
  args: {
    archived?: boolean;
    proposal?: string;
    design?: string;
    tasks?: string;
    stagedSpecs?: Record<string, string>;
    extraFiles?: Record<string, string>;
  },
) {
  const changeDir = args.archived
    ? join(repoPath, "openspec", "changes", "archive", changeName)
    : join(repoPath, "openspec", "changes", changeName);
  const specsDir = join(changeDir, "specs");
  await mkdir(changeDir, { recursive: true });

  if (args.proposal) {
    await writeFile(join(changeDir, "proposal.md"), args.proposal, "utf8");
  }

  if (args.design) {
    await writeFile(join(changeDir, "design.md"), args.design, "utf8");
  }

  if (args.tasks) {
    await writeFile(join(changeDir, "tasks.md"), args.tasks, "utf8");
  }

  for (const [relativePath, content] of Object.entries(args.stagedSpecs ?? {})) {
    const targetPath = join(specsDir, relativePath);
    await mkdir(join(targetPath, ".."), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }

  for (const [relativePath, content] of Object.entries(args.extraFiles ?? {})) {
    const targetPath = join(changeDir, relativePath);
    await mkdir(join(targetPath, ".."), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }
}

async function writeKnowledgeNote(repoPath: string, relativePath: string, content: string) {
  const targetPath = join(repoPath, "crabyard", "knowledge", relativePath);
  await mkdir(join(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function writeKnowledgeIndex(repoPath: string, entries: string) {
  await writeFile(join(repoPath, "crabyard", "knowledge", "index.md"), `# Knowledge Index\n\n## Entries\n\n${entries}`, "utf8");
}

function buildTasks(titles: string[], checked = true) {
  const marker = checked ? "- [x]" : "- [ ]";
  return titles.map((title, index) => `## ${index + 1}. ${title}\n${marker} Complete ${title.toLowerCase()}\n`).join("\n");
}

async function run(cwd: string, args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });

  return {
    code,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

function parseJson(value: string) {
  return JSON.parse(value) as any;
}

async function assertPathExists(targetPath: string) {
  try {
    await readFile(targetPath);
  } catch {
    throw new Error(`Expected path to exist: ${targetPath}`);
  }
}

async function assertPathMissing(targetPath: string) {
  try {
    await readFile(targetPath);
    throw new Error(`Expected path to be missing: ${targetPath}`);
  } catch (error) {
    if (error instanceof Error && /Expected path to be missing/.test(error.message)) {
      throw error;
    }
  }
}

async function pathExistsOnDisk(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
