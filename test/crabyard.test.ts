import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/crabyard.js";

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
