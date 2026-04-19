import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import {
  BACKUP_DIRNAME,
  CHANGE_ARTIFACT_FILES,
  CHANGE_REQUIRED_DIRECTORIES,
  CliIO,
  INSTRUCTIONS_FILE,
  InstallOptions,
  isDirectory,
  isListTarget,
  KNOWLEDGE_INDEX_FILE,
  LEGACY_AGENTS_BLOCKS,
  ListTarget,
  MANIFEST_FILE,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  PRIMARY_AGENTS_BLOCK,
  PRODUCT_NAME,
  PROJECT_FILE,
  REPO_SKILLS_DIR,
  REPO_SKILL_NAMES,
  RepoContext,
  ROOT_DIRNAME,
  TASK_FORMAT_FILE,
  createDateStamp,
  createTimestamp,
  defaultCliIO,
  escapeForRegex,
  findDuplicates,
  formatCliLabelValue,
  formatCliText,
  formatValidationErrors,
  formatYamlList,
  listMarkdownFiles,
  pathExists,
  printSection,
  resolveRepoRelative,
  splitCsv,
  toBulletList,
  toKebabCase,
  walkFiles,
  wrapManagedContent,
} from "./shared.js";
import {
  ParsedExecution,
  extractTaskHeadings,
  hasUncheckedTasks,
  normalizeTaskTitle,
  parseTaskSections,
  parseExecutionYaml,
  TaskSection,
  validateExecutionAgainstTasks,
  VerifyArtifactCheck,
  VerifyCheck,
  VerifyCommandCheck,
} from "./execution.js";

const manifestSchema = z
  .object({
    root: z.string().trim().min(1).optional(),
    project_file: z.string().trim().min(1).optional(),
    task_format_file: z.string().trim().min(1).optional(),
    instructions_file: z.string().trim().min(1).optional(),
    specs_root: z.string().trim().min(1).optional(),
    changes_root: z.string().trim().min(1).optional(),
    source_docs: z.array(z.string().trim().min(1)).optional(),
    default_tags: z.array(z.string().trim().min(1)).optional(),
    knowledge: z
      .object({
        root: z.string().trim().min(1).optional(),
        index: z.string().trim().min(1).optional(),
      })
      .passthrough()
      .optional(),
    skills: z
      .object({
        canonical_root: z.string().trim().min(1).optional(),
      })
      .passthrough()
      .optional(),
    managed_by: z
      .object({
        crabyard_version: z.string().trim().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const nonEmptyStringArraySchema = z.array(z.string().trim().min(1));

const knowledgeFrontmatterSchema = z
  .object({
    kind: z.string().trim().min(1).optional(),
    tags: nonEmptyStringArraySchema.optional(),
    paths: nonEmptyStringArraySchema.optional(),
    related_specs: nonEmptyStringArraySchema.optional(),
    related_changes: nonEmptyStringArraySchema.optional(),
    supersedes: z.union([z.string().trim().min(1), nonEmptyStringArraySchema]).optional(),
    last_verified_at: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .passthrough();

type ChangeValidationResult = {
  changeDir: string;
  errors: string[];
  tasksContent: string | null;
  headings: string[];
  execution: ParsedExecution | null;
  changeSpecsPath: string;
};

type SyncPlanEntry = {
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  action: "create" | "update" | "noop";
};

type SyncPlan = {
  entries: SyncPlanEntry[];
  pending: SyncPlanEntry[];
  coherent: boolean;
};

type CommonCommandOptions = {
  repoPath: string;
  json: boolean;
  args: string[];
};

type SearchCommandOptions = {
  repoPath: string;
  json: boolean;
  includeSpecs: boolean;
  query: string;
};

type MigrateOptions = {
  source: string;
  repoPath: string;
  backup: boolean;
  dryRun: boolean;
};

type OpenSpecMigrationReport = {
  activeChanges: number;
  archivedChanges: number;
  importedSpecs: number;
  preservedRootPaths: string[];
};

type ChangeUnitStatus = {
  id: string;
  title: string;
  complete: boolean;
  ready: boolean;
  blockedBy: string[];
  parallel: boolean;
  writes: string[];
  verify: VerifyCheck[];
};

type ReadyUnitFrontier = {
  id: string;
  title: string;
  parallel: boolean;
  writes: string[];
  verify: VerifyCheck[];
};

type BlockedUnitFrontier = {
  id: string;
  title: string;
  blockedBy: string[];
};

type ManagedAssetsStatus = {
  installedVersion: string;
  repoVersion: string | null;
  state: "current" | "stale" | "ahead" | "untracked";
  mismatch: boolean;
  hint: string | null;
};

type ChangeStatusReport = {
  kind: "change-status";
  repoPath: string;
  managedAssets: ManagedAssetsStatus;
  change: {
    name: string;
    path: string;
    archived: boolean;
  };
  state: "invalid" | "in-progress" | "ready-to-sync" | "ready-to-archive";
  validation: {
    valid: boolean;
    errors: string[];
  };
  verification: {
    ready: boolean;
    errors: string[];
    summary: {
      totalChecks: number;
      commandChecks: number;
      artifactChecks: number;
      readyUnitChecks: number;
      readyCommandChecks: number;
      readyArtifactChecks: number;
    };
  };
  tasks: {
    totalSections: number;
    completedSections: number;
    totalCheckboxes: number;
    checkedCheckboxes: number;
    uncheckedCheckboxes: number;
  };
  units: {
    total: number;
    complete: number;
    ready: number;
    blocked: number;
    pending: number;
    items: ChangeUnitStatus[];
  };
  sync: {
    coherent: boolean;
    pendingCount: number;
    pending: Array<{
      path: string;
      action: SyncPlanEntry["action"];
    }>;
  };
  frontier: {
    readyUnits: ReadyUnitFrontier[];
    blockedUnits: BlockedUnitFrontier[];
  };
};

type RepoStatusReport = {
  kind: "repo-status";
  repoPath: string;
  managedAssets: ManagedAssetsStatus;
  validation: {
    valid: boolean;
    errors: string[];
  };
  counts: {
    specs: number;
    knowledge: number;
    activeChanges: number;
    archivedChanges: number;
  };
  activeChanges: Array<{
    name: string;
    state: ChangeStatusReport["state"];
    readyUnits: number;
    pendingSync: number;
    archived: boolean;
  }>;
};

type CheckResult = {
  ok: boolean;
  kind: VerifyCheck["kind"];
  check: VerifyCheck;
  detail: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  actualState?: VerifyArtifactCheck["state"];
  timedOut?: boolean;
};

type CheckUnitReport = {
  id: string;
  title: string;
  complete: boolean;
  ready: boolean;
  blockedBy: string[];
  passed: number;
  failed: number;
  results: CheckResult[];
};

type CheckReport = {
  kind: "check";
  repoPath: string;
  change: string;
  ok: boolean;
  validationErrors: string[];
  summary: {
    units: number;
    checks: number;
    passed: number;
    failed: number;
  };
  units: CheckUnitReport[];
};

type SearchResultKind = "knowledge" | "spec";

type SearchResult = {
  kind: SearchResultKind;
  path: string;
  score: number;
  reason: "path-exact" | "path-match" | "index" | "body";
  summary: string;
};

type SearchReport = {
  kind: "search";
  repoPath: string;
  query: string;
  includeSpecs: boolean;
  results: SearchResult[];
};

type KnowledgeLintFinding = {
  level: "error";
  code:
    | "index-target-missing"
    | "index-duplicate-target"
    | "note-missing-index"
    | "frontmatter-parse-error"
    | "frontmatter-invalid"
    | "frontmatter-path-missing";
  path: string;
  detail: string;
};

type KnowledgeLintReport = {
  kind: "lint-knowledge";
  repoPath: string;
  ok: boolean;
  findings: KnowledgeLintFinding[];
};

type KnowledgeFrontmatter = {
  kind?: string;
  tags?: string[];
  paths?: string[];
  related_specs?: string[];
  related_changes?: string[];
  supersedes?: string | string[];
  last_verified_at?: string;
  [key: string]: unknown;
};

type ParsedMarkdownDocument = {
  frontmatter: KnowledgeFrontmatter | null;
  body: string;
  errors: string[];
};

type KnowledgeIndexEntry = {
  label: string;
  targetPath: string;
  tags: string[];
  summary: string;
};

type ParsedManifestValue = z.infer<typeof manifestSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_ASSETS_ROOT = resolve(PROJECT_ROOT, "assets/repo");

export async function runCli(argv: string[], io: CliIO = defaultCliIO()): Promise<number> {
  try {
    await dispatch(argv, io);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function dispatch(argv: string[], io: CliIO) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp(io);
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    io.stdout(PACKAGE_VERSION);
    return;
  }

  switch (command) {
    case "init":
    case "install":
      await runInit(rest, io);
      return;
    case "refresh":
    case "update":
      await runRefresh(rest, io);
      return;
    case "migrate":
      await runMigrate(rest, io);
      return;
    case "list":
      await runList(rest, io);
      return;
    case "show":
      await runShow(rest, io);
      return;
    case "validate":
      await runValidate(rest, io);
      return;
    case "status":
      await runStatus(rest, io);
      return;
    case "check":
      await runCheck(rest, io);
      return;
    case "verify":
      await runVerify(rest, io);
      return;
    case "search":
      await runSearch(rest, io);
      return;
    case "lint":
      await runLint(rest, io);
      return;
    case "sync":
      await runSync(rest, io);
      return;
    case "archive":
      await runArchive(rest, io);
      return;
    default:
      printHelp(io);
      throw new Error(`Unknown command: ${command}`);
  }
}

export function printHelp(io: CliIO) {
  io.stdout(`${PRODUCT_NAME}

Usage:
  ${PACKAGE_NAME} <command> [options]

Commands:
  version                                  Print the installed Crabyard version
  init [repo-path] [options]               Bootstrap Crabyard into a repo
  install [repo-path] [options]            Alias for init
  refresh [repo-path] [options]            Refresh repo-local Crabyard managed assets
  update [repo-path] [options]             Alias for refresh
  migrate openspec [repo-path] [options]   Copy OpenSpec artifacts into Crabyard
  list [all|specs|changes|knowledge]       List tracked repo artifacts
  show <target> [name]                     Show manifest, project, spec, change, or knowledge
  validate [repo]                          Validate the repo structure and active changes
  validate change <name>                   Validate a single change bundle
  status [change]                          Show repo status or execution status for a change
  check <change>                           Execute normalized verify checks for a change
  verify <change>                          Run the deterministic read-only gate for a change
  search <query>                           Search compiled knowledge (and optionally specs)
  lint knowledge                           Check the knowledge layer for drift and structure gaps
  sync <change>                            Copy staged change specs into accepted specs
  archive <change>                         Archive a verified and sync-coherent change bundle

Targets for show:
  manifest
  project
  task-format
  spec <name>
  change <name>
  knowledge <name>

Examples:
  pnpm exec tsx src/index.ts init /absolute/path/to/repo
  pnpm exec tsx src/index.ts refresh /absolute/path/to/repo
  pnpm exec tsx src/index.ts migrate openspec /absolute/path/to/repo
  node dist/index.js list specs --repo /absolute/path/to/repo
  node dist/index.js check add-auth --repo /absolute/path/to/repo
  node dist/index.js verify add-auth --repo /absolute/path/to/repo
  node dist/index.js search auth flow --repo /absolute/path/to/repo --include-specs
  node dist/index.js lint knowledge --repo /absolute/path/to/repo
  node dist/index.js sync add-auth --repo /absolute/path/to/repo
  node dist/index.js archive add-auth --repo /absolute/path/to/repo

Init options:
  --primary-docs <comma-separated-paths>
  --tags <comma-separated-tags>
  --skip-repo
  --backup
  --dry-run

Refresh options:
  --primary-docs <comma-separated-paths>
  --tags <comma-separated-tags>
  --backup
  --dry-run

The legacy \`update\` alias accepts the same options.

Migrate options:
  --backup
  --dry-run

Common options:
  --repo <path>
  --json
  --dry-run
  --help
`);
}

async function runInit(args: string[], io: CliIO) {
  await runRepoAssetCommand("init", args, io);
}

async function runRefresh(args: string[], io: CliIO) {
  await runRepoAssetCommand("refresh", args, io);
}

async function runMigrate(args: string[], io: CliIO) {
  const options = parseMigrateArgs(args, io.cwd);

  if (options.source !== "openspec") {
    throw new Error(
      "Usage: crabyard migrate openspec [repo-path] [--repo <path>] [--backup] [--dry-run]",
    );
  }

  const repoPath = resolve(options.repoPath);
  const openSpecRootPath = join(repoPath, "openspec");

  if (!(await isDirectory(openSpecRootPath))) {
    throw new Error(`Missing OpenSpec root at ${openSpecRootPath}`);
  }

  const repoName = basename(repoPath);
  const existingMetadata = await readRepoInstallMetadata(repoPath);
  const primaryDocs =
    (existingMetadata?.primaryDocs.length ?? 0) > 0 ? existingMetadata!.primaryDocs : await detectPrimaryDocs(repoPath);
  const tags =
    (existingMetadata?.tags.length ?? 0) > 0 ? existingMetadata!.tags : [toKebabCase(repoName)];
  const timestamp = createTimestamp();

  io.stdout(formatCliText("Migrating OpenSpec -> Crabyard", "heading"));
  io.stdout(formatCliLabelValue("Repo", repoPath));

  await installRepoAssets({
    repoPath,
    primaryDocs,
    tags,
    backup: options.backup,
    dryRun: options.dryRun,
    timestamp,
    mode: "init",
    io,
  });

  const report = await migrateOpenSpecRepo({
    repoPath,
    openSpecRootPath,
    dryRun: options.dryRun,
    io,
  });

  io.stdout(
    formatCliText(
      `Imported ${report.importedSpecs} spec file(s), ${report.activeChanges} active change(s), and ${report.archivedChanges} archived change(s).`,
      "success",
    ),
  );

  if (report.preservedRootPaths.length > 0) {
    io.stdout(formatCliText("Left in place for manual review:", "warning"));
    for (const relativePath of report.preservedRootPaths) {
      io.stdout(`- ${relativePath}`);
    }
  }

  io.stdout(formatCliText("Review generated execution.yaml files before relying on the migrated execution frontier.", "warning"));
  io.stdout(formatCliText("Migration complete.", "success"));
}

async function runRepoAssetCommand(mode: "init" | "refresh", args: string[], io: CliIO) {
  const options = parseInstallArgs(args, io.cwd);
  if (mode === "refresh" && options.skipRepo) {
    throw new Error("The refresh command does not support --skip-repo. The legacy `update` alias does not support it either.");
  }

  const repoPath = resolve(options.repoPath);
  const repoName = basename(repoPath);
  const existingMetadata = mode === "refresh" ? await readRepoInstallMetadata(repoPath) : null;
  const primaryDocs =
    options.primaryDocs.length > 0
      ? options.primaryDocs
      : (existingMetadata?.primaryDocs.length ?? 0) > 0
        ? existingMetadata!.primaryDocs
        : await detectPrimaryDocs(repoPath);
  const tags =
    options.tags.length > 0
      ? options.tags
      : (existingMetadata?.tags.length ?? 0) > 0
        ? existingMetadata!.tags
        : [toKebabCase(repoName)];
  const timestamp = createTimestamp();
  const managedAssetsBefore = mode === "refresh" ? buildManagedAssetsStatus(existingMetadata?.managedVersion ?? null) : null;

  io.stdout(formatCliText(mode === "init" ? `Initializing ${PRODUCT_NAME}` : `Refreshing ${PRODUCT_NAME}`, "heading"));
  io.stdout(formatCliLabelValue("Repo", repoPath));
  io.stdout(formatCliLabelValue("Source docs", primaryDocs.join(", ")));
  io.stdout(formatCliLabelValue("Tags", tags.join(", ")));
  if (managedAssetsBefore?.mismatch) {
    printManagedAssetsStatus(io, managedAssetsBefore);
  }

  if (!options.skipRepo) {
    await installRepoAssets({
      repoPath,
      primaryDocs,
      tags,
      backup: options.backup,
      dryRun: options.dryRun,
      timestamp,
      mode,
      io,
    });
  }

  if (mode === "refresh") {
    const managedAssetsAfter = options.dryRun ? managedAssetsBefore : buildManagedAssetsStatus(PACKAGE_VERSION);
    if (managedAssetsAfter) {
      printManagedAssetsStatus(io, managedAssetsAfter);
    }
  }

  io.stdout(formatCliText(mode === "init" ? "Init complete." : "Refresh complete.", "success"));
}

async function runList(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);
  const target = positional[0] ?? "all";

  if (!isListTarget(target) || positional.length > 1) {
    throw new Error("Usage: crabyard list [all|specs|changes|knowledge] [--repo <path>]");
  }

  const context = await loadRepoContext(repoPath);
  const specs = target === "all" || target === "specs" ? await listSpecEntries(context) : [];
  const activeChanges = target === "all" || target === "changes" ? await listActiveChangeEntries(context) : [];
  const archivedChanges = target === "all" || target === "changes" ? await listArchivedChangeEntries(context) : [];
  const knowledge = target === "all" || target === "knowledge" ? await listKnowledgeEntries(context) : [];

  if (json) {
    printJson(io, {
      kind: "list",
      repoPath: context.repoPath,
      target,
      specs,
      changes: {
        active: activeChanges,
        archived: archivedChanges,
      },
      knowledge,
    });
    return;
  }

  io.stdout(`Repo: ${context.repoPath}`);
  io.stdout("");

  if (target === "all" || target === "specs") {
    printSection(io, "Specs", specs);
  }

  if (target === "all" || target === "changes") {
    printSection(io, "Active Changes", activeChanges);
    printSection(io, "Archived Changes", archivedChanges);
  }

  if (target === "all" || target === "knowledge") {
    printSection(io, "Knowledge", knowledge);
  }
}

async function runShow(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);

  if (positional.length === 0) {
    throw new Error("Usage: crabyard show <manifest|project|task-format|spec|change|knowledge> [name] [--repo <path>]");
  }

  const context = await loadRepoContext(repoPath);
  const [target, name] = positional;

  switch (target) {
    case "manifest":
      await printArtifact(context.manifestPath, context.repoPath, io, json, "manifest");
      return;
    case "project":
      await printArtifact(context.projectFilePath, context.repoPath, io, json, "project");
      return;
    case "task-format":
      await printArtifact(context.taskFormatPath, context.repoPath, io, json, "task-format");
      return;
    case "spec":
      if (!name) {
        throw new Error("Usage: crabyard show spec <name> [--repo <path>]");
      }
      await printArtifact(await findSpecFile(context, name), context.repoPath, io, json, "spec", name);
      return;
    case "knowledge":
      if (!name) {
        throw new Error("Usage: crabyard show knowledge <name> [--repo <path>]");
      }
      await printArtifact(await findKnowledgeFile(context, name), context.repoPath, io, json, "knowledge", name);
      return;
    case "change":
      if (!name) {
        throw new Error("Usage: crabyard show change <name> [--repo <path>]");
      }
      await printChangeBundle(await findChangeDirectory(context, name, true), context.repoPath, io, json);
      return;
    default:
      throw new Error(`Unknown show target: ${target}`);
  }
}

async function runValidate(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);
  const context = await loadRepoContext(repoPath);
  const managedAssets = await readManagedAssetsStatus(context.repoPath);

  if (positional.length === 0 || (positional.length === 1 && positional[0] === "repo")) {
    const errors = await validateRepo(context);
    if (errors.length > 0) {
      if (json) {
        printJson(io, {
          kind: "validate-repo",
          repoPath: context.repoPath,
          managedAssets,
          valid: false,
          errors,
        });
      } else {
        printManagedAssetsStatus(io, managedAssets);
      }
      throw new Error(formatValidationErrors("Repo validation failed.", errors));
    }
    if (json) {
      printJson(io, {
        kind: "validate-repo",
        repoPath: context.repoPath,
        managedAssets,
        valid: true,
        errors: [],
      });
      return;
    }
    io.stdout("Repo validation passed.");
    printManagedAssetsStatus(io, managedAssets);
    return;
  }

  if (positional[0] === "change" && positional[1] && positional.length === 2) {
    const changeDir = await findChangeDirectory(context, positional[1], true);
    const result = await validateChangeDirectory(changeDir);
    if (result.errors.length > 0) {
      if (json) {
        printJson(io, {
          kind: "validate-change",
          repoPath: context.repoPath,
          change: basename(changeDir),
          managedAssets,
          valid: false,
          errors: result.errors,
        });
      } else {
        printManagedAssetsStatus(io, managedAssets);
      }
      throw new Error(formatValidationErrors(`Change ${basename(changeDir)} validation failed.`, result.errors));
    }
    if (json) {
      printJson(io, {
        kind: "validate-change",
        repoPath: context.repoPath,
        change: basename(changeDir),
        managedAssets,
        valid: true,
        errors: [],
      });
      return;
    }
    io.stdout(`Change ${basename(changeDir)} validation passed.`);
    printManagedAssetsStatus(io, managedAssets);
    return;
  }

  throw new Error("Usage: crabyard validate [repo] [--repo <path>] OR crabyard validate change <name> [--repo <path>]");
}

async function runStatus(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);
  const context = await loadRepoContext(repoPath);

  if (positional.length > 1) {
    throw new Error("Usage: crabyard status [change] [--repo <path>] [--json]");
  }

  if (positional.length === 0 || positional[0] === "repo") {
    const report = await buildRepoStatus(context);
    if (json) {
      printJson(io, report);
      return;
    }
    printRepoStatus(report, io);
    return;
  }

  const report = await buildChangeStatus(context, positional[0]);
  if (json) {
    printJson(io, report);
    return;
  }
  printChangeStatus(report, io);
}

async function runCheck(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);

  if (positional.length !== 1) {
    throw new Error("Usage: crabyard check <change> [--repo <path>] [--json]");
  }

  const context = await loadRepoContext(repoPath);
  const report = await buildCheckReport(context, positional[0]);

  if (json) {
    printJson(io, report);
  }

  if (!report.ok) {
    if (!json) {
      printCheckReport(report, io);
    }
    throw new Error(formatValidationErrors("Change check failed.", collectCheckErrors(report)));
  }

  if (!json) {
    printCheckReport(report, io);
  }
}

async function runVerify(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);

  if (positional.length !== 1) {
    throw new Error("Usage: crabyard verify <change> [--repo <path>]");
  }

  const context = await loadRepoContext(repoPath);
  const report = await buildChangeStatus(context, positional[0]);

  if (!report.verification.ready) {
    if (json) {
      printJson(io, {
        kind: "verify",
        repoPath: context.repoPath,
        change: report.change.name,
        ready: false,
        errors: report.verification.errors,
        sync: report.sync,
      });
    }
    throw new Error(formatValidationErrors("Change failed verification.", report.verification.errors));
  }

  if (json) {
    printJson(io, {
      kind: "verify",
      repoPath: context.repoPath,
      change: report.change.name,
      ready: true,
      errors: [],
      sync: report.sync,
    });
    return;
  }

  io.stdout(formatCliText(`Change ${report.change.name} verified.`, "success"));
  if (report.sync.pendingCount > 0) {
    io.stdout(
      formatCliLabelValue("Sync required", `${report.sync.pendingCount} staged spec file(s) differ from accepted specs.`, {
        valueTone: "warning",
      }),
    );
  } else {
    io.stdout(formatCliText("Sync state coherent.", "success"));
  }
}

async function runSearch(args: string[], io: CliIO) {
  const options = parseSearchArgs(args, io.cwd);
  const context = await loadRepoContext(options.repoPath);
  const report = await buildSearchReport(context, options.query, options.includeSpecs);

  if (options.json) {
    printJson(io, report);
    return;
  }

  printSearchReport(report, io);
}

async function runLint(args: string[], io: CliIO) {
  const { repoPath, json, args: positional } = parseCommonFlags(args, io.cwd);

  if (positional.length !== 1 || positional[0] !== "knowledge") {
    throw new Error("Usage: crabyard lint knowledge [--repo <path>] [--json]");
  }

  const context = await loadRepoContext(repoPath);
  const report = await buildKnowledgeLintReport(context);

  if (json) {
    printJson(io, report);
  }

  if (!report.ok) {
    if (!json) {
      printKnowledgeLintReport(report, io);
    }
    throw new Error(formatValidationErrors("Knowledge lint failed.", report.findings.map(formatKnowledgeLintFinding)));
  }

  if (!json) {
    printKnowledgeLintReport(report, io);
  }
}

async function runSync(args: string[], io: CliIO) {
  const { repoPath, args: positional } = parseRepoFlag(args, io.cwd);

  if (positional.length !== 1) {
    throw new Error("Usage: crabyard sync <change> [--repo <path>]");
  }

  const context = await loadRepoContext(repoPath);
  const verification = await verifyChange(context, positional[0]);
  const changeDir = verification.changeDir;
  const plan = verification.syncPlan;

  if (plan.pending.length === 0) {
    io.stdout(formatCliText(`Change ${basename(changeDir)} is already sync-coherent.`, "success"));
    return;
  }

  for (const entry of plan.pending) {
    await mkdir(dirname(entry.targetPath), { recursive: true });
    const content = await readFile(entry.sourcePath);
    await writeFile(entry.targetPath, content);
  }

  io.stdout(formatCliText(`Synced ${plan.pending.length} spec file(s) for ${basename(changeDir)}.`, "success"));
  for (const entry of plan.pending) {
    io.stdout(`- ${entry.action} ${relative(context.repoPath, entry.targetPath)}`);
  }
}

async function runArchive(args: string[], io: CliIO) {
  const { repoPath, args: positional } = parseRepoFlag(args, io.cwd);
  let dryRun = false;
  let changeName = "";

  for (const value of positional) {
    if (value === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (value === "--force") {
      throw new Error("The archive command no longer supports --force. Run verify and sync first.");
    }

    if (value.startsWith("--")) {
      throw new Error(`Unknown flag: ${value}`);
    }

    if (!changeName) {
      changeName = value;
      continue;
    }

    throw new Error("Usage: crabyard archive <change> [--repo <path>] [--dry-run]");
  }

  if (!changeName) {
    throw new Error("Usage: crabyard archive <change> [--repo <path>] [--dry-run]");
  }

  const context = await loadRepoContext(repoPath);
  const verification = await verifyChange(context, changeName);

  if (!verification.syncPlan.coherent) {
    throw new Error(formatValidationErrors("Change is not ready for archive.", formatSyncPlanErrors(verification.syncPlan)));
  }

  const archiveRoot = join(context.changesRootPath, "archive");
  const archiveDir = join(archiveRoot, `${createDateStamp()}-${basename(verification.changeDir)}`);

  if (await pathExists(archiveDir)) {
    throw new Error(`Archive destination already exists: ${archiveDir}`);
  }

  if (dryRun) {
    io.stdout(
      formatCliText(
        `[dry-run] archive ${relative(context.repoPath, verification.changeDir)} -> ${relative(context.repoPath, archiveDir)}`,
        "warning",
      ),
    );
    return;
  }

  await mkdir(archiveRoot, { recursive: true });
  await rename(verification.changeDir, archiveDir);
  io.stdout(formatCliText(`Archived ${basename(verification.changeDir)} -> ${archiveDir}`, "success"));
}

function parseInstallArgs(args: string[], cwd: string): InstallOptions {
  let repoPath = cwd;
  let primaryDocs: string[] = [];
  let tags: string[] = [];
  let skipRepo = false;
  let dryRun = false;
  let backup = false;
  let repoPathSet = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value.startsWith("--") && !repoPathSet) {
      repoPath = value;
      repoPathSet = true;
      continue;
    }

    switch (value) {
      case "--repo": {
        const next = args[index + 1];
        if (!next) throw new Error("`--repo` requires a path.");
        repoPath = next;
        repoPathSet = true;
        index += 1;
        break;
      }
      case "--primary-docs": {
        const next = args[index + 1];
        if (!next) throw new Error("`--primary-docs` requires a comma-separated value.");
        primaryDocs = splitCsv(next);
        index += 1;
        break;
      }
      case "--tags": {
        const next = args[index + 1];
        if (!next) throw new Error("`--tags` requires a comma-separated value.");
        tags = splitCsv(next).map(toKebabCase);
        index += 1;
        break;
      }
      case "--skip-repo":
        skipRepo = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--backup":
        backup = true;
        break;
      default:
        throw new Error(`Unknown flag: ${value}`);
    }
  }

  return {
    repoPath,
    primaryDocs,
    tags,
    skipRepo,
    dryRun,
    backup,
  };
}

function getChangeStateTone(state: ChangeStatusReport["state"]) {
  switch (state) {
    case "ready-to-archive":
      return "success" as const;
    case "ready-to-sync":
      return "warning" as const;
    case "in-progress":
      return "accent" as const;
    case "invalid":
      return "error" as const;
  }
}

function parseMigrateArgs(args: string[], cwd: string): MigrateOptions {
  let source = "";
  let repoPath = cwd;
  let backup = false;
  let dryRun = false;
  let repoPathSet = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value.startsWith("--") && !source) {
      source = value;
      continue;
    }

    if (!value.startsWith("--") && !repoPathSet) {
      repoPath = value;
      repoPathSet = true;
      continue;
    }

    switch (value) {
      case "--repo": {
        const next = args[index + 1];
        if (!next) throw new Error("`--repo` requires a path.");
        repoPath = next;
        repoPathSet = true;
        index += 1;
        break;
      }
      case "--backup":
        backup = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        throw new Error(`Unknown flag: ${value}`);
    }
  }

  return {
    source,
    repoPath,
    backup,
    dryRun,
  };
}

function parseCommonFlags(args: string[], cwd: string): CommonCommandOptions {
  let repoPath = cwd;
  let json = false;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--repo") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("`--repo` requires a path.");
      }
      repoPath = next;
      index += 1;
      continue;
    }

    if (value === "--json") {
      json = true;
      continue;
    }

    positional.push(value);
  }

  return {
    repoPath: resolve(repoPath),
    json,
    args: positional,
  };
}

function parseSearchArgs(args: string[], cwd: string): SearchCommandOptions {
  let repoPath = cwd;
  let json = false;
  let includeSpecs = false;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--repo") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("`--repo` requires a path.");
      }
      repoPath = next;
      index += 1;
      continue;
    }

    if (value === "--json") {
      json = true;
      continue;
    }

    if (value === "--include-specs") {
      includeSpecs = true;
      continue;
    }

    positional.push(value);
  }

  if (positional.length === 0) {
    throw new Error("Usage: crabyard search <query> [--repo <path>] [--json] [--include-specs]");
  }

  return {
    repoPath: resolve(repoPath),
    json,
    includeSpecs,
    query: positional.join(" ").trim(),
  };
}

function parseRepoFlag(args: string[], cwd: string): { repoPath: string; args: string[] } {
  let repoPath = cwd;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--repo") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("`--repo` requires a path.");
      }
      repoPath = next;
      index += 1;
      continue;
    }

    positional.push(value);
  }

  return {
    repoPath: resolve(repoPath),
    args: positional,
  };
}

async function detectPrimaryDocs(repoPath: string): Promise<string[]> {
  const candidates = ["README.md", "docs/README.md"];
  const result: string[] = [];

  for (const candidate of candidates) {
    if (await pathExists(join(repoPath, candidate))) {
      result.push(candidate);
    }
  }

  return result.length > 0 ? result : ["README.md"];
}

async function readRepoInstallMetadata(repoPath: string): Promise<{ primaryDocs: string[]; tags: string[]; managedVersion: string | null } | null> {
  const manifestPath = join(repoPath, ROOT_DIRNAME, MANIFEST_FILE);
  if (!(await pathExists(manifestPath))) {
    return null;
  }

  const document = parseDocument(await readFile(manifestPath, "utf8"));
  if (document.errors.length > 0) {
    throw new Error(`Invalid manifest.yaml: ${document.errors[0]?.message ?? "unknown YAML parse error"}`);
  }

  const parsed = manifestSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new Error(`Invalid manifest.yaml: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }

  return {
    primaryDocs: parsed.data.source_docs ?? [],
    tags: parsed.data.default_tags ?? [],
    managedVersion: parsed.data.managed_by?.crabyard_version ?? null,
  };
}

export async function loadRepoContext(repoPath: string): Promise<RepoContext> {
  const defaultManifestPath = join(repoPath, ROOT_DIRNAME, MANIFEST_FILE);
  const hasManifest = await pathExists(defaultManifestPath);
  const manifest = hasManifest ? await parseManifest(await readFile(defaultManifestPath, "utf8")) : null;
  const rootDir = manifest?.root ?? ROOT_DIRNAME;

  return {
    repoPath,
    rootDir,
    rootPath: resolveRepoRelative(repoPath, rootDir),
    manifestPath: defaultManifestPath,
    projectFilePath: resolveRepoRelative(repoPath, manifest?.projectFile ?? join(rootDir, PROJECT_FILE)),
    taskFormatPath: resolveRepoRelative(repoPath, manifest?.taskFormatFile ?? join(rootDir, TASK_FORMAT_FILE)),
    instructionsPath: resolveRepoRelative(repoPath, manifest?.instructionsFile ?? INSTRUCTIONS_FILE),
    specsRootPath: resolveRepoRelative(repoPath, manifest?.specsRoot ?? join(rootDir, "specs")),
    changesRootPath: resolveRepoRelative(repoPath, manifest?.changesRoot ?? join(rootDir, "changes")),
    knowledgeRootPath: resolveRepoRelative(repoPath, manifest?.knowledgeRoot ?? join(rootDir, "knowledge")),
    knowledgeIndexPath: resolveRepoRelative(repoPath, manifest?.knowledgeIndex ?? join(rootDir, KNOWLEDGE_INDEX_FILE)),
    repoSkillsPath: resolveRepoRelative(repoPath, manifest?.repoSkillsRoot ?? REPO_SKILLS_DIR),
    hasManifest,
  };
}

async function parseManifest(content: string) {
  const document = parseDocument(content);
  if (document.errors.length > 0) {
    throw new Error(`Invalid manifest.yaml: ${document.errors[0]?.message ?? "unknown YAML parse error"}`);
  }

  const parsed = manifestSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new Error(`Invalid manifest.yaml: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }

  return mapParsedManifest(parsed.data);
}

function mapParsedManifest(manifest: ParsedManifestValue) {
  return {
    root: manifest.root,
    projectFile: manifest.project_file,
    taskFormatFile: manifest.task_format_file,
    instructionsFile: manifest.instructions_file,
    specsRoot: manifest.specs_root,
    changesRoot: manifest.changes_root,
    knowledgeRoot: manifest.knowledge?.root,
    knowledgeIndex: manifest.knowledge?.index,
    repoSkillsRoot: manifest.skills?.canonical_root,
  };
}

async function installRepoAssets(args: {
  repoPath: string;
  primaryDocs: string[];
  tags: string[];
  backup: boolean;
  dryRun: boolean;
  timestamp: string;
  mode: "init" | "refresh";
  io: CliIO;
}) {
  const backupRoot = join(args.repoPath, BACKUP_DIRNAME, "backups", args.timestamp);
  const context = await loadRepoContext(args.repoPath);
  const routing = buildRoutingPaths(context);
  const managedManifestData = buildManagedManifestData(context.rootDir, args.primaryDocs, args.tags);
  const existingManifestConfig = await readExistingManifestConfig(context.manifestPath);
  const workflow = existingManifestConfig?.workflow ?? managedManifestData.workflow;

  args.io.stdout(formatCliText(`Installing repo assets -> ${args.repoPath}`, "heading"));

  for (const skillName of REPO_SKILL_NAMES) {
    await copyManagedPath({
      sourcePath: join(REPO_ASSETS_ROOT, REPO_SKILLS_DIR, skillName),
      targetPath: join(context.repoSkillsPath, skillName),
      backupRoot,
      backupEnabled: args.backup,
      baseRoot: args.repoPath,
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  await writeManagedFile({
    filePath: context.projectFilePath,
    content: buildProjectFile(args.primaryDocs, args.tags, {
      instructionsFile: routing.instructionsFile,
      specsRoot: routing.specsRoot,
      changeSpecsRoot: `${routing.changesRoot}/<slug>/specs`,
      knowledgeRoot: routing.knowledgeRoot,
      workflow,
    }),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    overwriteExisting: args.mode === "init",
    io: args.io,
  });

  await writeManagedManifest({
    filePath: context.manifestPath,
    primaryDocs: args.primaryDocs,
    tags: args.tags,
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: context.taskFormatPath,
    content: await readFile(join(REPO_ASSETS_ROOT, ROOT_DIRNAME, TASK_FORMAT_FILE), "utf8"),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    overwriteExisting: args.mode === "init",
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(context.specsRootPath, "README.md"),
    content: buildBucketReadme(
      "Specs",
      "Store accepted product behavior, contracts, and invariants here. Sync staged change specs into this tree with `crabyard sync <change>`.",
    ),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    overwriteExisting: args.mode === "init",
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(context.changesRootPath, "README.md"),
    content: buildChangesReadme(),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    overwriteExisting: args.mode === "init",
    io: args.io,
  });

  await writeManagedFile({
    filePath: context.knowledgeIndexPath,
    content: buildKnowledgeIndex(),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    overwriteExisting: args.mode === "init",
    io: args.io,
  });

  await updateAgentsFile({
    filePath: context.instructionsPath,
    content: buildAgentsBlock({
      instructionsFile: routing.instructionsFile,
      manifestFile: routing.manifestFile,
      projectFile: routing.projectFile,
      specsRoot: routing.specsRoot,
      changesRoot: routing.changesRoot,
      knowledgeRoot: routing.knowledgeRoot,
      repoSkillsRoot: routing.repoSkillsRoot,
      workflow,
    }),
    backupRoot,
    backupEnabled: args.backup,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });
}

async function migrateOpenSpecRepo(args: {
  repoPath: string;
  openSpecRootPath: string;
  dryRun: boolean;
  io: CliIO;
}): Promise<OpenSpecMigrationReport> {
  const sourceSpecsRoot = join(args.openSpecRootPath, "specs");
  const sourceChangesRoot = join(args.openSpecRootPath, "changes");
  const targetSpecsRoot = join(args.repoPath, ROOT_DIRNAME, "specs");
  const targetChangesRoot = join(args.repoPath, ROOT_DIRNAME, "changes");
  const report: OpenSpecMigrationReport = {
    activeChanges: 0,
    archivedChanges: 0,
    importedSpecs: 0,
    preservedRootPaths: [],
  };

  if (await isDirectory(sourceSpecsRoot)) {
    report.importedSpecs = await copySourceTree({
      sourceRoot: sourceSpecsRoot,
      targetRoot: targetSpecsRoot,
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  if (await isDirectory(sourceChangesRoot)) {
    const entries = (await readdir(sourceChangesRoot, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      const sourcePath = join(sourceChangesRoot, entry.name);

      if (entry.isDirectory() && entry.name === "archive") {
        report.archivedChanges = await migrateOpenSpecArchivedChanges({
          sourceArchiveRoot: sourcePath,
          targetArchiveRoot: join(targetChangesRoot, "archive"),
          dryRun: args.dryRun,
          io: args.io,
        });
        continue;
      }

      if (entry.isDirectory()) {
        await migrateOpenSpecChangeDirectory({
          sourceChangeDir: sourcePath,
          targetChangeDir: join(targetChangesRoot, entry.name),
          changeRelativePath: `${ROOT_DIRNAME}/changes/${entry.name}`,
          dryRun: args.dryRun,
          io: args.io,
        });
        report.activeChanges += 1;
        continue;
      }

      if (entry.isFile()) {
        await copyMigrationFile({
          sourcePath,
          targetPath: join(targetChangesRoot, entry.name),
          dryRun: args.dryRun,
          io: args.io,
        });
      }
    }
  }

  for (const relativePath of ["openspec/config.yaml", "openspec/explorations", "openspec/project.md"]) {
    if (await pathExists(join(args.repoPath, relativePath))) {
      report.preservedRootPaths.push(relativePath);
    }
  }

  return report;
}

async function migrateOpenSpecArchivedChanges(args: {
  sourceArchiveRoot: string;
  targetArchiveRoot: string;
  dryRun: boolean;
  io: CliIO;
}): Promise<number> {
  if (!(await isDirectory(args.sourceArchiveRoot))) {
    return 0;
  }

  let archivedChanges = 0;
  const entries = (await readdir(args.sourceArchiveRoot, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const sourcePath = join(args.sourceArchiveRoot, entry.name);

    if (entry.isDirectory()) {
      await migrateOpenSpecChangeDirectory({
        sourceChangeDir: sourcePath,
        targetChangeDir: join(args.targetArchiveRoot, entry.name),
        changeRelativePath: `${ROOT_DIRNAME}/changes/archive/${entry.name}`,
        dryRun: args.dryRun,
        io: args.io,
      });
      archivedChanges += 1;
      continue;
    }

    if (entry.isFile()) {
      await copyMigrationFile({
        sourcePath,
        targetPath: join(args.targetArchiveRoot, entry.name),
        dryRun: args.dryRun,
        io: args.io,
      });
    }
  }

  return archivedChanges;
}

async function migrateOpenSpecChangeDirectory(args: {
  sourceChangeDir: string;
  targetChangeDir: string;
  changeRelativePath: string;
  dryRun: boolean;
  io: CliIO;
}) {
  await ensureMigrationDirectory(args.targetChangeDir, args.dryRun);

  const sourceFiles = await walkFiles(args.sourceChangeDir);
  for (const sourcePath of sourceFiles) {
    const relativePath = relative(args.sourceChangeDir, sourcePath).replace(/\\/g, "/");

    if (
      relativePath === "proposal.md" ||
      relativePath === "design.md" ||
      relativePath === "tasks.md" ||
      relativePath === "execution.yaml" ||
      relativePath.startsWith("specs/")
    ) {
      continue;
    }

    await copyMigrationFile({
      sourcePath,
      targetPath: join(args.targetChangeDir, relativePath),
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  const sourceProposalPath = join(args.sourceChangeDir, "proposal.md");
  if (await pathExists(sourceProposalPath)) {
    await copyMigrationFile({
      sourcePath: sourceProposalPath,
      targetPath: join(args.targetChangeDir, "proposal.md"),
      dryRun: args.dryRun,
      io: args.io,
    });
  } else {
    await writeMigrationFile({
      targetPath: join(args.targetChangeDir, "proposal.md"),
      content: buildMigrationPlaceholder("Proposal", [
        "The original OpenSpec change did not include `proposal.md`.",
        "Review the staged specs and task list, then replace this placeholder with intent, scope, and acceptance target.",
      ]),
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  const sourceDesignPath = join(args.sourceChangeDir, "design.md");
  if (await pathExists(sourceDesignPath)) {
    await copyMigrationFile({
      sourcePath: sourceDesignPath,
      targetPath: join(args.targetChangeDir, "design.md"),
      dryRun: args.dryRun,
      io: args.io,
    });
  } else {
    await writeMigrationFile({
      targetPath: join(args.targetChangeDir, "design.md"),
      content: buildMigrationPlaceholder("Design", [
        "The original OpenSpec change did not include `design.md`.",
        "Review `proposal.md`, `tasks.md`, and the staged specs, then replace this placeholder with implementation shape and tradeoffs.",
      ]),
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  const tasksContent = await migrateOpenSpecTasks({
    sourceChangeDir: args.sourceChangeDir,
    targetChangeDir: args.targetChangeDir,
    changeRelativePath: args.changeRelativePath,
    dryRun: args.dryRun,
    io: args.io,
  });

  const sourceSpecsRoot = join(args.sourceChangeDir, "specs");
  const targetSpecsRoot = join(args.targetChangeDir, "specs");
  await ensureMigrationDirectory(targetSpecsRoot, args.dryRun);
  if (await isDirectory(sourceSpecsRoot)) {
    await copySourceTree({
      sourceRoot: sourceSpecsRoot,
      targetRoot: targetSpecsRoot,
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  await writeMigrationFile({
    targetPath: join(args.targetChangeDir, "execution.yaml"),
    content: buildMigratedExecutionYaml(tasksContent, args.changeRelativePath),
    dryRun: args.dryRun,
    io: args.io,
  });
}

async function migrateOpenSpecTasks(args: {
  sourceChangeDir: string;
  targetChangeDir: string;
  changeRelativePath: string;
  dryRun: boolean;
  io: CliIO;
}): Promise<string> {
  const sourceTasksPath = join(args.sourceChangeDir, "tasks.md");
  const targetTasksPath = join(args.targetChangeDir, "tasks.md");

  if (!(await pathExists(sourceTasksPath))) {
    const placeholder = buildMissingMigrationTasks();
    await writeMigrationFile({
      targetPath: targetTasksPath,
      content: placeholder,
      dryRun: args.dryRun,
      io: args.io,
    });
    return placeholder;
  }

  const sourceContent = await readFile(sourceTasksPath, "utf8");
  if (extractTaskHeadings(sourceContent).length > 0) {
    await copyMigrationFile({
      sourcePath: sourceTasksPath,
      targetPath: targetTasksPath,
      dryRun: args.dryRun,
      io: args.io,
    });
    return sourceContent;
  }

  await copyMigrationFile({
    sourcePath: sourceTasksPath,
    targetPath: join(args.targetChangeDir, "tasks.openspec.md"),
    dryRun: args.dryRun,
    io: args.io,
  });

  const normalizedTasks = buildNormalizedMigrationTasks(args.changeRelativePath);
  await writeMigrationFile({
    targetPath: targetTasksPath,
    content: normalizedTasks,
    dryRun: args.dryRun,
    io: args.io,
  });
  return normalizedTasks;
}

async function copySourceTree(args: {
  sourceRoot: string;
  targetRoot: string;
  dryRun: boolean;
  io: CliIO;
}): Promise<number> {
  const sourceFiles = await walkFiles(args.sourceRoot);

  for (const sourcePath of sourceFiles) {
    const relativePath = relative(args.sourceRoot, sourcePath);
    await copyMigrationFile({
      sourcePath,
      targetPath: join(args.targetRoot, relativePath),
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  return sourceFiles.length;
}

async function ensureMigrationDirectory(targetPath: string, dryRun: boolean) {
  if (await pathExists(targetPath)) {
    if (!(await isDirectory(targetPath))) {
      throw new Error(`Expected directory but found file: ${targetPath}`);
    }
    return;
  }

  if (dryRun) {
    return;
  }

  await mkdir(targetPath, { recursive: true });
}

async function copyMigrationFile(args: {
  sourcePath: string;
  targetPath: string;
  dryRun: boolean;
  io: CliIO;
}) {
  await writeMigrationTarget({
    targetPath: args.targetPath,
    content: await readFile(args.sourcePath),
    dryRun: args.dryRun,
    io: args.io,
    dryRunVerb: "copy",
    successVerb: "copied",
  });
}

async function writeMigrationFile(args: {
  targetPath: string;
  content: string;
  dryRun: boolean;
  io: CliIO;
}) {
  await writeMigrationTarget({
    targetPath: args.targetPath,
    content: args.content,
    dryRun: args.dryRun,
    io: args.io,
    dryRunVerb: "write",
    successVerb: "wrote",
  });
}

async function writeMigrationTarget(args: {
  targetPath: string;
  content: string | Buffer;
  dryRun: boolean;
  io: CliIO;
  dryRunVerb: "copy" | "write";
  successVerb: "copied" | "wrote";
}) {
  const nextContent = typeof args.content === "string" ? Buffer.from(args.content, "utf8") : args.content;

  if (await pathExists(args.targetPath)) {
    const targetStats = await stat(args.targetPath);
    if (!targetStats.isFile()) {
      throw new Error(`Expected file but found directory: ${args.targetPath}`);
    }

    const existing = await readFile(args.targetPath);
    if (Buffer.compare(existing, nextContent) === 0) {
      args.io.stdout(`unchanged ${args.targetPath}`);
      return;
    }

    throw new Error(`Refusing to overwrite existing file with different content: ${args.targetPath}`);
  }

  if (args.dryRun) {
    args.io.stdout(`[dry-run] ${args.dryRunVerb} ${args.targetPath}`);
    return;
  }

  await mkdir(dirname(args.targetPath), { recursive: true });
  await writeFile(args.targetPath, nextContent);
  args.io.stdout(`${args.successVerb} ${args.targetPath}`);
}

function buildMigrationPlaceholder(title: string, lines: string[]): string {
  return `# ${title}

Migrated from OpenSpec.

${lines.join("\n")}
`;
}

function buildMissingMigrationTasks(): string {
  return `# Implementation Tasks

## 1. Rebuild Migrated Plan
- [ ] Review \`proposal.md\`, \`design.md\`, and staged specs
- [ ] Rewrite this file into concrete Crabyard execution sections
`;
}

function buildNormalizedMigrationTasks(changeRelativePath: string): string {
  return `# Implementation Tasks

## 1. Normalize Migrated OpenSpec Tasks
- [ ] Review the original OpenSpec checklist in \`${changeRelativePath}/tasks.openspec.md\`
- [ ] Rewrite this file into top-level \`##\` execution sections for Crabyard
`;
}

function buildMigratedExecutionYaml(tasksContent: string, changeRelativePath: string): string {
  const sections = parseTaskSections(tasksContent);
  const execution = {
    version: 1 as const,
    tasks_file: "tasks.md",
    units: sections.map((section, index) => ({
      id: `T${index + 1}`,
      title: section.title,
      parallel: false,
      depends_on: index === 0 ? [] : [`T${index}`],
      writes: inferMigratedWrites(section, changeRelativePath),
      verify: [
        {
          kind: "artifact" as const,
          path: `${changeRelativePath}/tasks.md`,
          state: "exists" as const,
          notes: "Replace this placeholder verify check after migration.",
        },
      ],
      notes: "Migrated from OpenSpec. Review inferred writes and placeholder verify metadata before relying on this execution graph.",
    })),
  };

  return stringify(execution).trimEnd() + "\n";
}

function inferMigratedWrites(section: TaskSection, changeRelativePath: string): string[] {
  const writes = new Set<string>();

  for (const line of section.lines) {
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const candidate = normalizeMigratedWriteCandidate(match[1] ?? "", changeRelativePath);
      if (candidate) {
        writes.add(candidate);
      }
    }
  }

  if (writes.size === 0) {
    writes.add(`${changeRelativePath}/`);
  }

  return [...writes].sort();
}

function normalizeMigratedWriteCandidate(value: string, changeRelativePath: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");

  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith("-")) {
    return null;
  }

  const mappedRoot =
    trimmed.startsWith("openspec/") ? `${ROOT_DIRNAME}/${trimmed.slice("openspec/".length)}` : trimmed;

  if (
    mappedRoot === "proposal.md" ||
    mappedRoot === "design.md" ||
    mappedRoot === "tasks.md" ||
    mappedRoot === "execution.yaml" ||
    mappedRoot === "review.md"
  ) {
    return `${changeRelativePath}/${mappedRoot}`;
  }

  if (mappedRoot.startsWith("specs/")) {
    return `${changeRelativePath}/${mappedRoot}`;
  }

  if (mappedRoot.startsWith("/") || mappedRoot.startsWith("../")) {
    return null;
  }

  if (!mappedRoot.includes("/") && !/\.[A-Za-z0-9]+$/.test(mappedRoot)) {
    return null;
  }

  return mappedRoot;
}

async function listSpecEntries(context: RepoContext): Promise<string[]> {
  const files = await listMarkdownFiles(context.specsRootPath, new Set(["README.md"]));
  return files.map((filePath) => relative(context.repoPath, filePath));
}

async function listKnowledgeEntries(context: RepoContext): Promise<string[]> {
  const files = await listMarkdownFiles(context.knowledgeRootPath, new Set(["index.md"]));
  return files.map((filePath) => relative(context.repoPath, filePath));
}

async function listActiveChangeEntries(context: RepoContext): Promise<string[]> {
  return listChangeDirectories(context.changesRootPath, false);
}

async function listArchivedChangeEntries(context: RepoContext): Promise<string[]> {
  return listChangeDirectories(context.changesRootPath, true);
}

async function listChangeDirectories(changesRootPath: string, archived: boolean): Promise<string[]> {
  const targetPath = archived ? join(changesRootPath, "archive") : changesRootPath;

  if (!(await pathExists(targetPath))) {
    return [];
  }

  const entries = await readdir(targetPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => archived || entry.name !== "archive")
    .map((entry) => entry.name)
    .sort();
}

async function printArtifact(
  filePath: string,
  repoPath: string,
  io: CliIO,
  json: boolean,
  target: string,
  name?: string,
) {
  if (!(await pathExists(filePath))) {
    throw new Error(`Missing file: ${filePath}`);
  }

  const content = await readFile(filePath, "utf8");

  if (json) {
    printJson(io, {
      kind: "show",
      repoPath,
      target,
      name: name ?? null,
      path: relative(repoPath, filePath),
      content,
    });
    return;
  }

  io.stdout(formatCliText(`=== ${relative(repoPath, filePath)} ===`, "heading"));
  io.stdout(content.trimEnd());
}

async function printChangeBundle(changeDir: string, repoPath: string, io: CliIO, json: boolean) {
  const files = (await walkFiles(changeDir)).sort();

  if (files.length === 0) {
    throw new Error(`No files found in change bundle: ${changeDir}`);
  }

  if (json) {
    const entries = await Promise.all(
      files.map(async (filePath) => ({
        path: relative(repoPath, filePath),
        content: await readFile(filePath, "utf8"),
      })),
    );

    printJson(io, {
      kind: "show-change",
      repoPath,
      change: basename(changeDir),
      path: relative(repoPath, changeDir),
      files: entries,
    });
    return;
  }

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    io.stdout(formatCliText(`=== ${relative(repoPath, filePath)} ===`, "heading"));
    io.stdout(content.trimEnd());
    io.stdout("");
  }
}

async function buildRepoStatus(context: RepoContext): Promise<RepoStatusReport> {
  const [managedAssets, validationErrors, specs, knowledge, activeChanges, archivedChanges] = await Promise.all([
    readManagedAssetsStatus(context.repoPath),
    validateRepo(context),
    listSpecEntries(context),
    listKnowledgeEntries(context),
    listActiveChangeEntries(context),
    listArchivedChangeEntries(context),
  ]);

  const activeChangeReports = await Promise.all(activeChanges.map((changeName) => buildChangeStatus(context, changeName, managedAssets)));

  return {
    kind: "repo-status",
    repoPath: context.repoPath,
    managedAssets,
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors,
    },
    counts: {
      specs: specs.length,
      knowledge: knowledge.length,
      activeChanges: activeChanges.length,
      archivedChanges: archivedChanges.length,
    },
    activeChanges: activeChangeReports.map((report) => ({
      name: report.change.name,
      state: report.state,
      readyUnits: report.units.ready,
      pendingSync: report.sync.pendingCount,
      archived: report.change.archived,
    })),
  };
}

async function buildChangeStatus(
  context: RepoContext,
  changeName: string,
  managedAssets?: ManagedAssetsStatus,
): Promise<ChangeStatusReport> {
  const managedAssetStatus = managedAssets ?? (await readManagedAssetsStatus(context.repoPath));
  const changeDir = await findChangeDirectory(context, changeName, true);
  const validation = await validateChangeDirectory(changeDir);
  const taskSections = validation.tasksContent ? parseTaskSections(validation.tasksContent) : [];
  const syncPlan = await buildSyncPlan(context, changeDir);
  const unitStatuses = buildUnitStatuses(validation.execution, taskSections);
  const verificationErrors = [...validation.errors];
  const tasksPath = join(changeDir, "tasks.md");

  if (validation.tasksContent && hasUncheckedTasks(validation.tasksContent)) {
    verificationErrors.push(`tasks.md still contains unchecked items in ${relative(context.repoPath, tasksPath)}`);
  }

  const completedSections = taskSections.filter((section) => section.complete).length;
  const totalCheckboxes = taskSections.reduce((sum, section) => sum + section.checkboxCount, 0);
  const checkedCheckboxes = taskSections.reduce((sum, section) => sum + section.checkedCount, 0);
  const uncheckedCheckboxes = taskSections.reduce((sum, section) => sum + section.uncheckedCount, 0);
  const pendingUnits = unitStatuses.filter((unit) => !unit.complete && !unit.ready && unit.blockedBy.length === 0).length;
  const verificationReady = verificationErrors.length === 0;
  const readyUnits = unitStatuses.filter((unit) => unit.ready);
  const blockedUnits = unitStatuses.filter((unit) => unit.blockedBy.length > 0);
  const allVerifyChecks = unitStatuses.flatMap((unit) => unit.verify);
  const readyVerifyChecks = readyUnits.flatMap((unit) => unit.verify);

  let state: ChangeStatusReport["state"] = "invalid";
  if (validation.execution && validation.errors.length === 0) {
    state = !verificationReady ? "in-progress" : !syncPlan.coherent ? "ready-to-sync" : "ready-to-archive";
  }

  return {
    kind: "change-status",
    repoPath: context.repoPath,
    managedAssets: managedAssetStatus,
    change: {
      name: basename(changeDir),
      path: relative(context.repoPath, changeDir),
      archived: relative(context.changesRootPath, changeDir).startsWith("archive/"),
    },
    state,
    validation: {
      valid: validation.errors.length === 0,
      errors: validation.errors,
    },
    verification: {
      ready: verificationReady,
      errors: verificationErrors,
      summary: {
        totalChecks: allVerifyChecks.length,
        commandChecks: allVerifyChecks.filter((check) => check.kind === "command").length,
        artifactChecks: allVerifyChecks.filter((check) => check.kind === "artifact").length,
        readyUnitChecks: readyVerifyChecks.length,
        readyCommandChecks: readyVerifyChecks.filter((check) => check.kind === "command").length,
        readyArtifactChecks: readyVerifyChecks.filter((check) => check.kind === "artifact").length,
      },
    },
    tasks: {
      totalSections: taskSections.length,
      completedSections,
      totalCheckboxes,
      checkedCheckboxes,
      uncheckedCheckboxes,
    },
    units: {
      total: unitStatuses.length,
      complete: unitStatuses.filter((unit) => unit.complete).length,
      ready: readyUnits.length,
      blocked: blockedUnits.length,
      pending: pendingUnits,
      items: unitStatuses,
    },
    sync: {
      coherent: syncPlan.coherent,
      pendingCount: syncPlan.pending.length,
      pending: syncPlan.pending.map((entry) => ({
        path: entry.relativePath,
        action: entry.action,
      })),
    },
    frontier: {
      readyUnits: readyUnits.map((unit) => ({
        id: unit.id,
        title: unit.title,
        parallel: unit.parallel,
        writes: unit.writes,
        verify: unit.verify,
      })),
      blockedUnits: blockedUnits.map((unit) => ({
        id: unit.id,
        title: unit.title,
        blockedBy: unit.blockedBy,
      })),
    },
  };
}

async function buildCheckReport(context: RepoContext, changeName: string): Promise<CheckReport> {
  const changeDir = await findChangeDirectory(context, changeName, false);
  const validation = await validateChangeDirectory(changeDir);

  if (!validation.execution || validation.errors.length > 0) {
    return {
      kind: "check",
      repoPath: context.repoPath,
      change: basename(changeDir),
      ok: false,
      validationErrors: validation.errors,
      summary: {
        units: validation.execution?.units.length ?? 0,
        checks: 0,
        passed: 0,
        failed: 0,
      },
      units: [],
    };
  }

  const taskSections = validation.tasksContent ? parseTaskSections(validation.tasksContent) : [];
  const unitStatuses = buildUnitStatuses(validation.execution, taskSections);
  const reports: CheckUnitReport[] = [];

  for (const unit of unitStatuses) {
    const results: CheckResult[] = [];

    for (const check of unit.verify) {
      results.push(await executeVerifyCheck(context.repoPath, check));
    }

    reports.push({
      id: unit.id,
      title: unit.title,
      complete: unit.complete,
      ready: unit.ready,
      blockedBy: unit.blockedBy,
      passed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  }

  const passed = reports.reduce((sum, unit) => sum + unit.passed, 0);
  const failed = reports.reduce((sum, unit) => sum + unit.failed, 0);

  return {
    kind: "check",
    repoPath: context.repoPath,
    change: basename(changeDir),
    ok: validation.errors.length === 0 && failed === 0,
    validationErrors: validation.errors,
    summary: {
      units: reports.length,
      checks: passed + failed,
      passed,
      failed,
    },
    units: reports,
  };
}

async function executeVerifyCheck(repoPath: string, check: VerifyCheck): Promise<CheckResult> {
  return check.kind === "command" ? executeCommandCheck(repoPath, check) : executeArtifactCheck(repoPath, check);
}

async function executeCommandCheck(repoPath: string, check: VerifyCommandCheck): Promise<CheckResult> {
  let cwd = repoPath;

  try {
    cwd = check.cwd ? resolveRepoRelative(repoPath, check.cwd) : repoPath;
  } catch (error) {
    return {
      ok: false,
      kind: "command",
      check,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const commandLabel = check.argv ? check.argv.join(" ") : check.run ?? "";

    const child = check.argv
      ? spawn(check.argv[0], check.argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(check.run ?? "", { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });

    const finish = (result: CheckResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolveResult(result);
    };

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        kind: "command",
        check,
        detail: `command failed to start: ${error.message}`,
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
      });
    });

    if (check.timeoutMs) {
      killTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, check.timeoutMs);
    }

    child.on("close", (code, signal) => {
      const stdoutValue = stdout.trim() || undefined;
      const stderrValue = stderr.trim() || undefined;

      if (timedOut) {
        finish({
          ok: false,
          kind: "command",
          check,
          detail: `timed out after ${check.timeoutMs}ms: ${commandLabel}`,
          stdout: stdoutValue,
          stderr: stderrValue,
          exitCode: code,
          timedOut: true,
        });
        return;
      }

      if (code === check.expectExitCode) {
        finish({
          ok: true,
          kind: "command",
          check,
          detail: `exit ${code}: ${commandLabel}`,
          stdout: stdoutValue,
          stderr: stderrValue,
          exitCode: code,
        });
        return;
      }

      finish({
        ok: false,
        kind: "command",
        check,
        detail:
          signal !== null
            ? `terminated by ${signal}: ${commandLabel}`
            : `expected exit ${check.expectExitCode}, got ${code ?? "null"}: ${commandLabel}`,
        stdout: stdoutValue,
        stderr: stderrValue,
        exitCode: code,
      });
    });
  });
}

async function executeArtifactCheck(repoPath: string, check: VerifyArtifactCheck): Promise<CheckResult> {
  let targetPath = "";

  try {
    targetPath = resolveRepoRelative(repoPath, check.path);
  } catch (error) {
    return {
      ok: false,
      kind: "artifact",
      check,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const exists = await pathExists(targetPath);
  const actualState: VerifyArtifactCheck["state"] = exists ? "exists" : "missing";
  const ok = actualState === check.state;

  return {
    ok,
    kind: "artifact",
    check,
    detail: `${relative(repoPath, targetPath)} is ${actualState}`,
    actualState,
  };
}

function collectCheckErrors(report: CheckReport): string[] {
  const errors = [...report.validationErrors];

  for (const unit of report.units) {
    for (const result of unit.results) {
      if (!result.ok) {
        errors.push(`${unit.id} ${unit.title}: ${result.detail}`);
      }
    }
  }

  return errors;
}

function buildUnitStatuses(execution: ParsedExecution | null, taskSections: TaskSection[]): ChangeUnitStatus[] {
  if (!execution) {
    return [];
  }

  const sectionByTitle = new Map(taskSections.map((section) => [section.normalizedTitle, section]));
  const completeIds = new Set<string>();

  for (const unit of execution.units) {
    const section = sectionByTitle.get(normalizeTaskTitle(unit.title));
    if (section?.complete) {
      completeIds.add(unit.id);
    }
  }

  return execution.units.map((unit) => {
    const section = sectionByTitle.get(normalizeTaskTitle(unit.title));
    const complete = section?.complete ?? false;
    const blockedBy = complete ? [] : unit.dependsOn.filter((dependency) => !completeIds.has(dependency));

    return {
      id: unit.id,
      title: unit.title,
      complete,
      ready: !complete && blockedBy.length === 0,
      blockedBy,
      parallel: unit.parallel,
      writes: unit.writes,
      verify: unit.verify,
    };
  });
}

function printRepoStatus(report: RepoStatusReport, io: CliIO) {
  io.stdout(formatCliLabelValue("Repo", report.repoPath));
  printManagedAssetsStatus(io, report.managedAssets);
  io.stdout(
    formatCliLabelValue("Validation", report.validation.valid ? "valid" : "invalid", {
      valueTone: report.validation.valid ? "success" : "error",
    }),
  );
  io.stdout(
    formatCliLabelValue(
      "Counts",
      `${report.counts.activeChanges} active change(s), ${report.counts.archivedChanges} archived, ${report.counts.specs} spec file(s), ${report.counts.knowledge} knowledge note(s)`,
    ),
  );

  if (report.validation.errors.length > 0) {
    io.stdout(formatCliText("Validation Errors:", "warning"));
    for (const error of report.validation.errors) {
      io.stdout(`- ${error}`);
    }
  }

  if (report.activeChanges.length === 0) {
    io.stdout(formatCliLabelValue("Active Changes", "none", { valueTone: "muted" }));
    return;
  }

  io.stdout(formatCliText("Active Changes:", "heading"));
  for (const change of report.activeChanges) {
    io.stdout(
      `- ${change.name}: ${formatCliText(change.state, getChangeStateTone(change.state))}; ready units=${change.readyUnits}; pending sync=${change.pendingSync}`,
    );
  }
}

function printChangeStatus(report: ChangeStatusReport, io: CliIO) {
  io.stdout(formatCliLabelValue("Change", report.change.name));
  io.stdout(formatCliLabelValue("Path", report.change.path));
  printManagedAssetsStatus(io, report.managedAssets);
  io.stdout(formatCliLabelValue("State", report.state, { valueTone: getChangeStateTone(report.state) }));
  io.stdout(
    formatCliLabelValue(
      "Tasks",
      `${report.tasks.completedSections}/${report.tasks.totalSections} sections complete; ${report.tasks.checkedCheckboxes}/${report.tasks.totalCheckboxes} checkbox items checked`,
    ),
  );
  io.stdout(
    formatCliLabelValue(
      "Units",
      `${report.units.complete}/${report.units.total} complete; ${report.units.ready} ready; ${report.units.blocked} blocked; ${report.units.pending} pending`,
    ),
  );
  io.stdout(
    formatCliLabelValue(
      "Verify",
      `${report.verification.summary.totalChecks} check(s); ready frontier has ${report.verification.summary.readyUnitChecks} check(s) across ${report.frontier.readyUnits.length} unit(s)`,
    ),
  );
  io.stdout(
    formatCliLabelValue(
      "Sync",
      report.sync.coherent ? "coherent" : `${report.sync.pendingCount} staged spec file(s) pending`,
      { valueTone: report.sync.coherent ? "success" : "warning" },
    ),
  );

  if (!report.validation.valid) {
    io.stdout(formatCliText("Validation Errors:", "warning"));
    for (const error of report.validation.errors) {
      io.stdout(`- ${error}`);
    }
  }

  if (report.frontier.readyUnits.length > 0) {
    io.stdout(formatCliText("Ready Units:", "heading"));
    for (const unit of report.frontier.readyUnits) {
      io.stdout(`- ${unit.id} ${unit.title}`);
      for (const check of unit.verify) {
        io.stdout(`  verify: ${formatVerifyCheck(check)}`);
      }
    }
  }

  if (report.frontier.blockedUnits.length > 0) {
    io.stdout(formatCliText("Blocked Units:", "warning"));
    for (const unit of report.frontier.blockedUnits) {
      io.stdout(`- ${unit.id} ${unit.title} <- ${unit.blockedBy.join(", ")}`);
    }
  }

  if (!report.verification.ready) {
    io.stdout(formatCliText("Verification Gaps:", "warning"));
    for (const error of report.verification.errors) {
      io.stdout(`- ${error}`);
    }
  }
}

function printCheckReport(report: CheckReport, io: CliIO) {
  io.stdout(formatCliLabelValue("Check", report.change));
  io.stdout(
    formatCliLabelValue(
      "Checks",
      `${report.summary.passed}/${report.summary.checks} passed across ${report.summary.units} unit(s)`,
      { valueTone: report.ok ? "success" : "warning" },
    ),
  );

  if (report.validationErrors.length > 0) {
    io.stdout(formatCliText("Validation Errors:", "warning"));
    for (const error of report.validationErrors) {
      io.stdout(`- ${error}`);
    }
  }

  for (const unit of report.units) {
    io.stdout(
      `- ${unit.id} ${unit.title}: ${formatCliText(String(unit.passed), "success")} passed, ${formatCliText(String(unit.failed), unit.failed > 0 ? "error" : "muted")} failed`,
    );
    for (const result of unit.results.filter((entry) => !entry.ok)) {
      io.stdout(`  ${formatCliText("fail:", "error")} ${result.detail}`);
    }
  }
}

function printSearchReport(report: SearchReport, io: CliIO) {
  io.stdout(formatCliLabelValue("Search", report.query));

  if (report.results.length === 0) {
    io.stdout(formatCliLabelValue("Results", "none", { valueTone: "muted" }));
    return;
  }

  io.stdout(formatCliLabelValue("Results", String(report.results.length), { valueTone: "accent" }));
  for (const result of report.results) {
    io.stdout(`- ${result.kind} ${result.path} [${result.reason}]`);
    io.stdout(`  ${result.summary}`);
  }
}

function printKnowledgeLintReport(report: KnowledgeLintReport, io: CliIO) {
  io.stdout(
    formatCliLabelValue("Knowledge Lint", report.ok ? "ok" : "failed", {
      valueTone: report.ok ? "success" : "error",
    }),
  );

  if (report.findings.length === 0) {
    io.stdout(formatCliLabelValue("Findings", "none", { valueTone: "muted" }));
    return;
  }

  for (const finding of report.findings) {
    io.stdout(`- ${formatKnowledgeLintFinding(finding)}`);
  }
}

function formatKnowledgeLintFinding(finding: KnowledgeLintFinding): string {
  return `${finding.code} ${finding.path}: ${finding.detail}`;
}

function formatVerifyCheck(check: VerifyCheck): string {
  if (check.kind === "command") {
    const target = check.argv ? check.argv.join(" ") : check.run ?? "";
    const parts = [target];
    if (check.cwd) {
      parts.push(`cwd=${check.cwd}`);
    }
    if (check.timeoutMs) {
      parts.push(`timeout=${check.timeoutMs}ms`);
    }
    if (check.expectExitCode !== 0) {
      parts.push(`exit=${check.expectExitCode}`);
    }
    return `command ${parts.join("; ")}`.trim();
  }

  return `artifact ${check.path} should be ${check.state}`;
}

export async function validateRepo(context: RepoContext): Promise<string[]> {
  const errors: string[] = [];

  await validateRequiredPath(errors, context.manifestPath, "Missing manifest file");
  await validateRequiredPath(errors, context.projectFilePath, "Missing project context file");
  await validateRequiredPath(errors, context.taskFormatPath, "Missing task execution format file");
  await validateRequiredPath(errors, context.specsRootPath, "Missing specs root");
  await validateRequiredPath(errors, context.changesRootPath, "Missing changes root");
  await validateRequiredPath(errors, context.knowledgeRootPath, "Missing knowledge root");
  await validateRequiredPath(errors, context.knowledgeIndexPath, "Missing knowledge index");
  await validateRequiredPath(errors, context.repoSkillsPath, "Missing canonical repo skills root");

  if (!(await pathExists(context.instructionsPath))) {
    errors.push(`Missing ${INSTRUCTIONS_FILE} at ${relative(context.repoPath, context.instructionsPath)}`);
  } else {
    const agentsContent = await readFile(context.instructionsPath, "utf8");
    if (!agentsContent.includes(PRIMARY_AGENTS_BLOCK.start) || !agentsContent.includes(PRIMARY_AGENTS_BLOCK.end)) {
      errors.push(`${INSTRUCTIONS_FILE} is missing the managed Crabyard memory block in ${relative(context.repoPath, context.instructionsPath)}`);
    }
  }

  const activeChanges = await listActiveChangeEntries(context);

  for (const changeName of activeChanges) {
    const changeDir = join(context.changesRootPath, changeName);
    const changeErrors = (await validateChangeDirectory(changeDir)).errors;
    for (const error of changeErrors) {
      errors.push(`[change ${changeName}] ${error}`);
    }
  }

  return errors;
}

export async function validateChangeDirectory(changeDir: string): Promise<ChangeValidationResult> {
  const errors: string[] = [];

  if (!(await pathExists(changeDir))) {
    return {
      changeDir,
      errors: [`Missing change directory: ${changeDir}`],
      tasksContent: null,
      headings: [],
      execution: null,
      changeSpecsPath: join(changeDir, "specs"),
    };
  }

  for (const fileName of CHANGE_ARTIFACT_FILES) {
    const artifactPath = join(changeDir, fileName);
    if (!(await pathExists(artifactPath))) {
      errors.push(`Missing required artifact ${relative(changeDir, artifactPath)}`);
    }
  }

  for (const directoryName of CHANGE_REQUIRED_DIRECTORIES) {
    const requiredPath = join(changeDir, directoryName);
    if (!(await isDirectory(requiredPath))) {
      errors.push(`Missing required directory ${relative(changeDir, requiredPath)}`);
    }
  }

  const tasksPath = join(changeDir, "tasks.md");
  const executionPath = join(changeDir, "execution.yaml");
  let tasksContent: string | null = null;
  let headings: string[] = [];
  let execution: ParsedExecution | null = null;

  if (await pathExists(tasksPath)) {
    tasksContent = await readFile(tasksPath, "utf8");
    headings = extractTaskHeadings(tasksContent);
    const duplicateHeadings = findDuplicates(headings.map(normalizeTaskTitle));

    if (headings.length === 0) {
      errors.push("tasks.md has no top-level `##` execution sections");
    }

    for (const heading of duplicateHeadings) {
      errors.push(`tasks.md contains duplicate top-level task sections: ${heading}`);
    }
  }

  if (await pathExists(executionPath)) {
    const parsedExecution = parseExecutionYaml(await readFile(executionPath, "utf8"));
    execution = parsedExecution.execution;
    errors.push(...parsedExecution.errors);
    if (execution && tasksContent) {
      errors.push(...validateExecutionAgainstTasks(changeDir, headings, execution));
    }
  }

  return {
    changeDir,
    errors,
    tasksContent,
    headings,
    execution,
    changeSpecsPath: join(changeDir, "specs"),
  };
}

async function verifyChange(context: RepoContext, changeName: string): Promise<{ changeDir: string; syncPlan: SyncPlan }> {
  const changeDir = await findChangeDirectory(context, changeName, false);
  const validation = await validateChangeDirectory(changeDir);
  const errors = [...validation.errors];
  const tasksPath = join(changeDir, "tasks.md");

  if (validation.tasksContent && hasUncheckedTasks(validation.tasksContent)) {
    errors.push(`tasks.md still contains unchecked items in ${relative(context.repoPath, tasksPath)}`);
  }

  if (errors.length > 0) {
    throw new Error(formatValidationErrors("Change failed verification.", errors));
  }

  return {
    changeDir,
    syncPlan: await buildSyncPlan(context, changeDir),
  };
}

async function buildSyncPlan(context: RepoContext, changeDir: string): Promise<SyncPlan> {
  const stagedRoot = join(changeDir, "specs");
  const stagedFiles = await walkFiles(stagedRoot);
  const entries: SyncPlanEntry[] = [];

  for (const sourcePath of stagedFiles.sort()) {
    const relativePath = relative(stagedRoot, sourcePath);
    const targetPath = join(context.specsRootPath, relativePath);
    const sourceContent = await readFile(sourcePath, "utf8");
    let action: SyncPlanEntry["action"] = "create";

    if (await pathExists(targetPath)) {
      const targetContent = await readFile(targetPath, "utf8");
      action = targetContent === sourceContent ? "noop" : "update";
    }

    entries.push({
      relativePath,
      sourcePath,
      targetPath,
      action,
    });
  }

  const pending = entries.filter((entry) => entry.action !== "noop");
  return {
    entries,
    pending,
    coherent: pending.length === 0,
  };
}

function formatSyncPlanErrors(plan: SyncPlan): string[] {
  return plan.pending.map((entry) => `Pending spec sync (${entry.action}): ${entry.relativePath}`);
}

async function buildSearchReport(context: RepoContext, query: string, includeSpecs: boolean): Promise<SearchReport> {
  const normalizedQuery = query.trim().toLowerCase();
  const querySlug = toKebabCase(query);
  const results: SearchResult[] = [];
  const knowledgeEntries = await loadKnowledgeIndexEntries(context);
  const knowledgeEntryByPath = new Map(knowledgeEntries.map((entry) => [entry.targetPath, entry]));
  const knowledgeNotes = await listMarkdownFiles(context.knowledgeRootPath, new Set(["index.md"]));

  for (const notePath of knowledgeNotes) {
    const repoRelativePath = relative(context.repoPath, notePath).replace(/\\/g, "/");
    const parsed = await parseMarkdownDocument(await readFile(notePath, "utf8"));
    const indexEntry = knowledgeEntryByPath.get(repoRelativePath);
    const match = rankSearchTarget({
      query: normalizedQuery,
      querySlug,
      path: repoRelativePath,
      pathForMatch: relative(context.knowledgeRootPath, notePath).replace(/\\/g, "/"),
      body: parsed.body,
      indexEntry,
    });

    if (match) {
      results.push({
        kind: "knowledge",
        path: repoRelativePath,
        score: match.score,
        reason: match.reason,
        summary: indexEntry?.summary || match.summary,
      });
    }
  }

  if (includeSpecs) {
    const specFiles = await listMarkdownFiles(context.specsRootPath, new Set(["README.md"]));

    for (const specPath of specFiles) {
      const repoRelativePath = relative(context.repoPath, specPath).replace(/\\/g, "/");
      const parsed = await parseMarkdownDocument(await readFile(specPath, "utf8"));
      const match = rankSearchTarget({
        query: normalizedQuery,
        querySlug,
        path: repoRelativePath,
        pathForMatch: relative(context.specsRootPath, specPath).replace(/\\/g, "/"),
        body: parsed.body,
      });

      if (match) {
        results.push({
          kind: "spec",
          path: repoRelativePath,
          score: match.score,
          reason: match.reason,
          summary: match.summary,
        });
      }
    }
  }

  results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  return {
    kind: "search",
    repoPath: context.repoPath,
    query,
    includeSpecs,
    results,
  };
}

async function buildKnowledgeLintReport(context: RepoContext): Promise<KnowledgeLintReport> {
  const findings: KnowledgeLintFinding[] = [];
  const noteFiles = await listMarkdownFiles(context.knowledgeRootPath, new Set(["index.md"]));
  const indexEntries = await loadKnowledgeIndexEntries(context);
  const indexTargets = new Map<string, number>();

  for (const entry of indexEntries) {
    indexTargets.set(entry.targetPath, (indexTargets.get(entry.targetPath) ?? 0) + 1);

    const absoluteTargetPath = resolve(context.repoPath, entry.targetPath);
    if (!(await pathExists(absoluteTargetPath))) {
      findings.push({
        level: "error",
        code: "index-target-missing",
        path: entry.targetPath,
        detail: "knowledge/index.md points to a missing note",
      });
    }
  }

  for (const [targetPath, count] of indexTargets.entries()) {
    if (count > 1) {
      findings.push({
        level: "error",
        code: "index-duplicate-target",
        path: targetPath,
        detail: `knowledge/index.md references this note ${count} times`,
      });
    }
  }

  const indexedTargets = new Set(indexEntries.map((entry) => entry.targetPath));

  for (const notePath of noteFiles) {
    const repoRelativePath = relative(context.repoPath, notePath).replace(/\\/g, "/");
    if (!indexedTargets.has(repoRelativePath)) {
      findings.push({
        level: "error",
        code: "note-missing-index",
        path: repoRelativePath,
        detail: "knowledge note has no canonical index entry",
      });
    }

    const parsed = await parseMarkdownDocument(await readFile(notePath, "utf8"));
    for (const error of parsed.errors) {
      findings.push({
        level: "error",
        code: "frontmatter-parse-error",
        path: repoRelativePath,
        detail: error,
      });
    }

    if (parsed.frontmatter) {
      const validated = knowledgeFrontmatterSchema.safeParse(parsed.frontmatter);
      if (!validated.success) {
        findings.push({
          level: "error",
          code: "frontmatter-invalid",
          path: repoRelativePath,
          detail: validated.error.issues.map((issue) => issue.message).join("; "),
        });
        continue;
      }

      for (const referencedPath of validated.data.paths ?? []) {
        let resolvedPath = "";

        try {
          resolvedPath = resolveRepoRelative(context.repoPath, referencedPath);
        } catch (error) {
          findings.push({
            level: "error",
            code: "frontmatter-path-missing",
            path: repoRelativePath,
            detail: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (!(await pathExists(resolvedPath))) {
          findings.push({
            level: "error",
            code: "frontmatter-path-missing",
            path: repoRelativePath,
            detail: `frontmatter path does not exist: ${referencedPath}`,
          });
        }
      }
    }
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));

  return {
    kind: "lint-knowledge",
    repoPath: context.repoPath,
    ok: findings.length === 0,
    findings,
  };
}

async function loadKnowledgeIndexEntries(context: RepoContext): Promise<KnowledgeIndexEntry[]> {
  if (!(await pathExists(context.knowledgeIndexPath))) {
    return [];
  }

  const content = await readFile(context.knowledgeIndexPath, "utf8");
  const entries: KnowledgeIndexEntry[] = [];
  const indexDir = dirname(context.knowledgeIndexPath);

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\[([^\]]+)\]\(([^)]+)\)(?:\s+-\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const [, label, rawTarget, metadata = ""] = match;
    const targetPath = relative(context.repoPath, resolve(indexDir, rawTarget)).replace(/\\/g, "/");
    const tags = [...metadata.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
    const summaryMatch = metadata.match(/summary:\s*([^;]+)/i);

    entries.push({
      label,
      targetPath,
      tags,
      summary: summaryMatch ? summaryMatch[1].trim() : metadata.trim(),
    });
  }

  return entries;
}

async function parseMarkdownDocument(content: string): Promise<ParsedMarkdownDocument> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {
      frontmatter: null,
      body: content,
      errors: [],
    };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: null,
      body: content,
      errors: ["frontmatter fence is not closed"],
    };
  }

  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    return {
      frontmatter: null,
      body: match[2],
      errors: document.errors.map((error) => error.message),
    };
  }

  const data = document.toJS();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      frontmatter: null,
      body: match[2],
      errors: ["frontmatter must parse to an object"],
    };
  }

  return {
    frontmatter: data as KnowledgeFrontmatter,
    body: match[2],
    errors: [],
  };
}

function rankSearchTarget(args: {
  query: string;
  querySlug: string;
  path: string;
  pathForMatch: string;
  body: string;
  indexEntry?: KnowledgeIndexEntry;
}): { score: number; reason: SearchResult["reason"]; summary: string } | null {
  const normalizedPath = args.pathForMatch.toLowerCase();
  const normalizedBase = basename(args.pathForMatch, ".md").toLowerCase();

  if (args.querySlug && (normalizedBase === args.querySlug || normalizedPath.replace(/\.md$/i, "") === args.querySlug)) {
    return {
      score: 300,
      reason: "path-exact",
      summary: `path exactly matches "${args.querySlug}"`,
    };
  }

  if (args.querySlug && (normalizedBase.includes(args.querySlug) || normalizedPath.includes(args.querySlug))) {
    return {
      score: 250,
      reason: "path-match",
      summary: `path matches "${args.querySlug}"`,
    };
  }

  if (args.indexEntry) {
    const indexText = `${args.indexEntry.tags.join(" ")} ${args.indexEntry.summary}`.toLowerCase();
    if (args.query && indexText.includes(args.query)) {
      return {
        score: 200,
        reason: "index",
        summary: args.indexEntry.summary || `index tags: ${args.indexEntry.tags.join(", ")}`,
      };
    }
  }

  const bodyLine = args.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().includes(args.query));
  if (args.query && bodyLine) {
    return {
      score: 100,
      reason: "body",
      summary: bodyLine,
    };
  }

  return null;
}

function printJson(io: CliIO, value: unknown) {
  io.stdout(JSON.stringify(value, null, 2));
}

async function findSpecFile(context: RepoContext, name: string): Promise<string> {
  return findMarkdownArtifact(context.specsRootPath, name, new Set(["README.md"]), [
    join(context.specsRootPath, name, "spec.md"),
    join(context.specsRootPath, `${name}.md`),
  ]);
}

async function findKnowledgeFile(context: RepoContext, name: string): Promise<string> {
  return findMarkdownArtifact(context.knowledgeRootPath, name, new Set(["index.md"]), [
    join(context.knowledgeRootPath, `${name}.md`),
  ]);
}

async function findMarkdownArtifact(
  rootPath: string,
  name: string,
  ignoredBasenames: Set<string>,
  directCandidates: string[],
): Promise<string> {
  for (const candidate of directCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  const query = toKebabCase(name);
  const files = await listMarkdownFiles(rootPath, ignoredBasenames);
  const matches = files.filter((filePath) => {
    const relativePath = toKebabCase(relative(rootPath, filePath).replace(/\.md$/i, ""));
    const baseName = toKebabCase(basename(filePath).replace(/\.md$/i, ""));
    const parentName = toKebabCase(basename(dirname(filePath)));
    return baseName === query || parentName === query || relativePath.includes(query);
  });

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(`No matching artifact found for ${name} under ${rootPath}`);
  }

  throw new Error(`Ambiguous artifact name ${name}; matches: ${matches.map((filePath) => relative(rootPath, filePath)).join(", ")}`);
}

async function findChangeDirectory(context: RepoContext, name: string, allowArchived: boolean): Promise<string> {
  const exactActivePath = join(context.changesRootPath, name);
  if ((await pathExists(exactActivePath)) && (await isDirectory(exactActivePath))) {
    return exactActivePath;
  }

  const query = toKebabCase(name);
  const activeMatches = (await listActiveChangeEntries(context)).filter((entry) => toKebabCase(entry).includes(query));

  if (activeMatches.length === 1) {
    return join(context.changesRootPath, activeMatches[0]);
  }

  if (activeMatches.length > 1) {
    throw new Error(`Ambiguous active change name ${name}; matches: ${activeMatches.join(", ")}`);
  }

  if (!allowArchived) {
    throw new Error(`No active change found for ${name}`);
  }

  const archivedMatches = (await listArchivedChangeEntries(context)).filter((entry) => toKebabCase(entry).includes(query));

  if (archivedMatches.length === 1) {
    return join(context.changesRootPath, "archive", archivedMatches[0]);
  }

  if (archivedMatches.length > 1) {
    throw new Error(`Ambiguous archived change name ${name}; matches: ${archivedMatches.join(", ")}`);
  }

  throw new Error(`No change found for ${name}`);
}

async function validateRequiredPath(errors: string[], targetPath: string, message: string) {
  if (!(await pathExists(targetPath))) {
    errors.push(`${message}: ${targetPath}`);
  }
}

async function updateAgentsFile(args: {
  filePath: string;
  content: string;
  backupRoot: string;
  backupEnabled: boolean;
  baseRoot: string;
  dryRun: boolean;
  io: CliIO;
}) {
  const existing = (await pathExists(args.filePath)) ? await readFile(args.filePath, "utf8") : "# AI development guide\n";
  const managedBlock = `${PRIMARY_AGENTS_BLOCK.start}\n${args.content}\n${PRIMARY_AGENTS_BLOCK.end}`;

  let nextContent = existing;
  let replaced = false;

  for (const marker of LEGACY_AGENTS_BLOCKS) {
    if (existing.includes(marker.start) && existing.includes(marker.end)) {
      const pattern = new RegExp(`${escapeForRegex(marker.start)}[\\s\\S]*?${escapeForRegex(marker.end)}`, "m");
      nextContent = existing.replace(pattern, managedBlock);
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    nextContent = `${existing.trimEnd()}\n\n${managedBlock}\n`;
  }

  if (args.dryRun) {
    args.io.stdout(formatCliText(`[dry-run] update ${args.filePath}`, "warning"));
    return;
  }

  if (args.backupEnabled && (await pathExists(args.filePath)) && existing !== nextContent) {
    await backupExisting(args.filePath, args.backupRoot, args.baseRoot, false, args.io);
  }

  await mkdir(dirname(args.filePath), { recursive: true });
  await writeFile(args.filePath, nextContent, "utf8");
  args.io.stdout(formatCliText(`updated ${args.filePath}`, "success"));
}

async function writeManagedFile(args: {
  filePath: string;
  content: string;
  backupRoot: string;
  backupEnabled: boolean;
  baseRoot: string;
  dryRun: boolean;
  overwriteExisting?: boolean;
  io: CliIO;
}) {
  const wrapped = wrapManagedContent(args.filePath, args.content);
  const exists = await pathExists(args.filePath);
  const overwriteExisting = args.overwriteExisting ?? true;

  if (exists) {
    if (!overwriteExisting) {
      args.io.stdout(formatCliText(`preserved ${args.filePath}`, "muted"));
      return;
    }

    const previous = await readFile(args.filePath, "utf8");
    if (previous === wrapped) {
      args.io.stdout(formatCliText(`unchanged ${args.filePath}`, "muted"));
      return;
    }
    if (args.backupEnabled) {
      await backupExisting(args.filePath, args.backupRoot, args.baseRoot, args.dryRun, args.io);
    }
  }

  if (args.dryRun) {
    args.io.stdout(formatCliText(`[dry-run] write ${args.filePath}`, "warning"));
    return;
  }

  await mkdir(dirname(args.filePath), { recursive: true });
  await writeFile(args.filePath, wrapped, "utf8");
  args.io.stdout(formatCliText(`wrote ${args.filePath}`, "success"));
}

async function writeManagedManifest(args: {
  filePath: string;
  primaryDocs: string[];
  tags: string[];
  backupRoot: string;
  backupEnabled: boolean;
  baseRoot: string;
  dryRun: boolean;
  io: CliIO;
}) {
  const wrapped = await buildManagedManifestContent(args.filePath, args.primaryDocs, args.tags);
  const exists = await pathExists(args.filePath);

  if (exists) {
    const previous = await readFile(args.filePath, "utf8");
    if (previous === wrapped) {
      args.io.stdout(formatCliText(`unchanged ${args.filePath}`, "muted"));
      return;
    }
    if (args.backupEnabled) {
      await backupExisting(args.filePath, args.backupRoot, args.baseRoot, args.dryRun, args.io);
    }
  }

  if (args.dryRun) {
    args.io.stdout(formatCliText(`[dry-run] write ${args.filePath}`, "warning"));
    return;
  }

  await mkdir(dirname(args.filePath), { recursive: true });
  await writeFile(args.filePath, wrapped, "utf8");
  args.io.stdout(formatCliText(`wrote ${args.filePath}`, "success"));
}

function buildRoutingPaths(context: RepoContext) {
  return {
    manifestFile: relative(context.repoPath, context.manifestPath),
    instructionsFile: relative(context.repoPath, context.instructionsPath),
    projectFile: relative(context.repoPath, context.projectFilePath),
    specsRoot: relative(context.repoPath, context.specsRootPath),
    changesRoot: relative(context.repoPath, context.changesRootPath),
    knowledgeRoot: relative(context.repoPath, context.knowledgeRootPath),
    repoSkillsRoot: relative(context.repoPath, context.repoSkillsPath),
  };
}

async function readExistingManifestConfig(filePath: string): Promise<{ workflow?: string[] } | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  const document = parseDocument(stripManagedHeader(content));
  if (document.errors.length > 0) {
    throw new Error(`Invalid manifest.yaml: ${document.errors[0]?.message ?? "unknown YAML parse error"}`);
  }

  const parsed = manifestSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new Error(`Invalid manifest.yaml: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }

  const data = parsed.data as Record<string, unknown>;
  return {
    workflow: readStringArrayField(data.workflow),
  };
}

function readStringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length === value.length ? normalized : undefined;
}

async function buildManagedManifestContent(filePath: string, primaryDocs: string[], tags: string[]): Promise<string> {
  if (!(await pathExists(filePath))) {
    return wrapManagedContent(filePath, buildManifest(primaryDocs, tags));
  }

  const current = await readFile(filePath, "utf8");
  const document = parseDocument(stripManagedHeader(current));
  if (document.errors.length > 0) {
    throw new Error(`Invalid manifest.yaml: ${document.errors[0]?.message ?? "unknown YAML parse error"}`);
  }

  const parsed = manifestSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new Error(`Invalid manifest.yaml: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }

  const rootDir = parsed.data.root ?? ROOT_DIRNAME;
  const existing = document.toJS() as Record<string, unknown>;
  const merged = mergeManagedManifest(existing, buildManagedManifestData(rootDir, primaryDocs, tags));
  return wrapManagedContent(filePath, stringify(merged));
}

function mergeManagedManifest(existing: Record<string, unknown>, managed: ReturnType<typeof buildManagedManifestData>) {
  const existingKnowledge =
    existing.knowledge && typeof existing.knowledge === "object" && !Array.isArray(existing.knowledge)
      ? (existing.knowledge as Record<string, unknown>)
      : {};
  const existingSkills =
    existing.skills && typeof existing.skills === "object" && !Array.isArray(existing.skills)
      ? (existing.skills as Record<string, unknown>)
      : {};
  const existingWritePolicy =
    existing.write_policy && typeof existing.write_policy === "object" && !Array.isArray(existing.write_policy)
      ? (existing.write_policy as Record<string, unknown>)
      : {};
  const existingManagedBy =
    existing.managed_by && typeof existing.managed_by === "object" && !Array.isArray(existing.managed_by)
      ? (existing.managed_by as Record<string, unknown>)
      : {};
  const existingWorkflow = readStringArrayField(existing.workflow);
  const existingRefreshScope = readStringArrayField(existing.refresh_scope);
  const existingNotes = readStringArrayField(existing.notes);

  return {
    ...existing,
    version: managed.version,
    root: existing.root ?? managed.root,
    project_file: existing.project_file ?? managed.project_file,
    task_format_file: existing.task_format_file ?? managed.task_format_file,
    instructions_file: existing.instructions_file ?? managed.instructions_file,
    specs_root: existing.specs_root ?? managed.specs_root,
    changes_root: existing.changes_root ?? managed.changes_root,
    knowledge: {
      ...existingKnowledge,
      root: existingKnowledge.root ?? managed.knowledge.root,
      index: existingKnowledge.index ?? managed.knowledge.index,
    },
    skills: {
      ...existingSkills,
      canonical_root: existingSkills.canonical_root ?? managed.skills.canonical_root,
    },
    managed_by: {
      ...existingManagedBy,
      crabyard_version: managed.managed_by.crabyard_version,
    },
    source_docs: managed.source_docs,
    workflow: existingWorkflow ?? managed.workflow,
    refresh_scope: existingRefreshScope ?? managed.refresh_scope,
    write_policy: {
      ...managed.write_policy,
      ...existingWritePolicy,
    },
    default_tags: managed.default_tags,
    notes: existingNotes ?? managed.notes,
  };
}

function stripManagedHeader(content: string): string {
  return content.replace(/^# Managed by [^\n]+\n/, "");
}

async function copyManagedPath(args: {
  sourcePath: string;
  targetPath: string;
  backupRoot: string;
  backupEnabled: boolean;
  baseRoot: string;
  dryRun: boolean;
  io: CliIO;
}) {
  if (!(await pathExists(args.sourcePath))) {
    throw new Error(`Missing installer asset: ${args.sourcePath}`);
  }

  if (await pathExists(args.targetPath)) {
    if (args.backupEnabled) {
      await backupExisting(args.targetPath, args.backupRoot, args.baseRoot, args.dryRun, args.io);
    }
    if (!args.dryRun) {
      await rm(args.targetPath, { recursive: true, force: true });
    }
  }

  if (args.dryRun) {
    args.io.stdout(formatCliText(`[dry-run] copy ${args.sourcePath} -> ${args.targetPath}`, "warning"));
    return;
  }

  await mkdir(dirname(args.targetPath), { recursive: true });
  await cp(args.sourcePath, args.targetPath, { recursive: true });
  args.io.stdout(formatCliText(`copied ${args.targetPath}`, "success"));
}

async function backupExisting(targetPath: string, backupRoot: string, baseRoot: string, dryRun: boolean, io: CliIO) {
  const backupPath = join(backupRoot, relative(baseRoot, targetPath));

  if (dryRun) {
    io.stdout(formatCliText(`[dry-run] backup ${targetPath} -> ${backupPath}`, "warning"));
    return;
  }

  await mkdir(dirname(backupPath), { recursive: true });
  await cp(targetPath, backupPath, { recursive: true });
  io.stdout(formatCliText(`backed up ${targetPath} -> ${backupPath}`, "success"));
}

function buildProjectFile(
  primaryDocs: string[],
  tags: string[],
  routes: {
    instructionsFile: string;
    specsRoot: string;
    changeSpecsRoot: string;
    knowledgeRoot: string;
    workflow: string[];
  },
): string {
  return `# Project Context

This file stores stable repo context for Crabyard agents. Keep it concise and durable.

## Source Docs

${toBulletList(primaryDocs)}

## Default Tags

${toBulletList(tags.map((tag) => `\`${tag}\``))}

## Guidance

- Prefer \`${routes.specsRoot}/\` for accepted product truth.
- Prefer \`${routes.changeSpecsRoot}/\` for in-flight accepted-truth edits that still need sync.
- Prefer \`${routes.knowledgeRoot}/\` for durable debugging, implementation, and operations notes.
- Run a knowledge retrieval pass before major decisions in explore, plan, and review.
- Prefer the core workflow \`${routes.workflow.join(" -> ")}\`.
- Use review as an optional gate before apply or closure when risk, ambiguity, or findings warrant it.
- Run sync and re-verify only when staged specs change accepted truth.
- Use learn/refresh only when durable knowledge should change.
- Treat \`${routes.instructionsFile}\` as the canonical repo-instruction file.
- Update this file only for stable repo-wide context, not task-by-task status.
`;
}

function buildManagedManifestData(rootDir: string, primaryDocs: string[], tags: string[]) {
  return {
    version: 1,
    root: rootDir,
    project_file: `${rootDir}/${PROJECT_FILE}`,
    task_format_file: `${rootDir}/${TASK_FORMAT_FILE}`,
    instructions_file: INSTRUCTIONS_FILE,
    specs_root: `${rootDir}/specs`,
    changes_root: `${rootDir}/changes`,
    knowledge: {
      root: `${rootDir}/knowledge`,
      index: `${rootDir}/${KNOWLEDGE_INDEX_FILE}`,
    },
    skills: {
      canonical_root: REPO_SKILLS_DIR,
    },
    managed_by: {
      crabyard_version: PACKAGE_VERSION,
    },
    source_docs: primaryDocs,
    workflow: ["explore", "plan", "apply", "verify", "archive"],
    refresh_scope: [`${rootDir}/knowledge`],
    write_policy: {
      forbid_paths: ["CLAUDE.md"],
      mutate_agents_only_when_routing_changes: true,
    },
    default_tags: tags,
    notes: [
      `Keep accepted product behavior and contracts in ${rootDir}/specs.`,
      `Keep in-flight accepted-truth edits in ${rootDir}/changes/<slug>/specs.`,
      `Keep durable implementation and debugging notes in ${rootDir}/knowledge.`,
      `Use retrieval from ${rootDir}/knowledge before major decisions in explore, plan, and review.`,
      `Use review as an optional gate before apply or closure when risk, ambiguity, or findings warrant it.`,
      `Run sync and re-verify only when staged specs change accepted truth.`,
      `Use learn/refresh only when durable knowledge should change.`,
      `Treat ${INSTRUCTIONS_FILE} as the canonical repo-instruction file.`,
    ],
  };
}

function buildManifest(primaryDocs: string[], tags: string[]): string {
  return stringify(buildManagedManifestData(ROOT_DIRNAME, primaryDocs, tags));
}

async function readManagedAssetsStatus(repoPath: string): Promise<ManagedAssetsStatus> {
  const metadata = await readRepoInstallMetadata(repoPath);
  return buildManagedAssetsStatus(metadata?.managedVersion ?? null);
}

function buildManagedAssetsStatus(repoVersion: string | null): ManagedAssetsStatus {
  if (!repoVersion) {
    return {
      installedVersion: PACKAGE_VERSION,
      repoVersion: null,
      state: "untracked",
      mismatch: true,
      hint: "This repo does not record a managed Crabyard version yet. Run `crabyard refresh <repo>` to sync and record it.",
    };
  }

  const comparison = compareCrabyardVersions(repoVersion, PACKAGE_VERSION);
  if (comparison < 0) {
    return {
      installedVersion: PACKAGE_VERSION,
      repoVersion,
      state: "stale",
      mismatch: true,
      hint: "Repo-managed assets are older than the installed CLI. Run `crabyard refresh <repo>` to sync this repo.",
    };
  }

  if (comparison > 0) {
    return {
      installedVersion: PACKAGE_VERSION,
      repoVersion,
      state: "ahead",
      mismatch: true,
      hint: "Repo-managed assets are newer than the installed CLI. Upgrade the CLI before refreshing this repo.",
    };
  }

  return {
    installedVersion: PACKAGE_VERSION,
    repoVersion,
    state: "current",
    mismatch: false,
    hint: null,
  };
}

function compareCrabyardVersions(left: string, right: string): number {
  const leftParts = parseCrabyardVersion(left);
  const rightParts = parseCrabyardVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }

  return 0;
}

function parseCrabyardVersion(value: string): number[] {
  return (value.match(/\d+/g) ?? []).map((entry) => Number.parseInt(entry, 10));
}

function printManagedAssetsStatus(io: CliIO, status: ManagedAssetsStatus) {
  io.stdout(
    formatCliLabelValue(
      "Managed Assets",
      `repo ${status.repoVersion ?? "untracked"}; installed CLI ${status.installedVersion}`,
      { valueTone: status.mismatch ? "warning" : "success" },
    ),
  );

  if (status.hint) {
    io.stdout(
      formatCliLabelValue("Refresh Hint", status.hint, {
        valueTone: status.state === "ahead" ? "warning" : "accent",
      }),
    );
  }
}

function buildBucketReadme(title: string, summary: string): string {
  return `# ${title}

${summary}
`;
}

function buildChangesReadme(): string {
  return `# Changes

Store one folder per in-flight change under this directory.

Archived changes move under:

\`\`\`text
archive/YYYY-MM-DD-<change>/
\`\`\`

Required change layout:

\`\`\`text
<change>/
  proposal.md
  design.md
  tasks.md
  execution.yaml
  specs/
  review.md
\`\`\`

- \`proposal.md\` explains the intent, scope, and acceptance target.
- \`design.md\` captures implementation shape and tradeoffs.
- \`tasks.md\` is the human-readable execution checklist.
- \`execution.yaml\` is the explicit execution graph and must stay trustworthy.
- \`specs/\` stages accepted-truth updates before \`crabyard sync <change>\`.
- \`review.md\` is optional but recommended for prioritized findings before verify.
- Use \`crabyard check <change>\` when you want to execute the normalized verify metadata instead of only checking closure gates.
`;
}

function buildKnowledgeIndex(): string {
  return `# Knowledge Index

Use this file as the retrieval index for durable implementation, debugging, and operations notes.

Format:

\`\`\`md
- [short-label](./topic.md) - tags: \`tag-a\`, \`tag-b\`; summary: one short sentence; supersedes: \`old-topic\` optional.
\`\`\`

Rules:

- Keep one canonical entry per retrieval target.
- Update entries when a note is consolidated, replaced, or superseded.
- Prefer focused notes over broad catch-all documents.
- Keep tags and summaries specific enough that retrieval can rank strong matches quickly.
- Optional note frontmatter may include \`kind\`, \`tags\`, \`paths\`, \`related_specs\`, \`related_changes\`, \`supersedes\`, and \`last_verified_at\`.

## Entries

- None yet.
`;
}

function buildAgentsBlock(routes: {
  instructionsFile: string;
  manifestFile: string;
  projectFile: string;
  specsRoot: string;
  changesRoot: string;
  knowledgeRoot: string;
  repoSkillsRoot: string;
  workflow: string[];
}): string {
  return `## Crabyard Memory
- Treat \`${routes.instructionsFile}\` as the canonical repo-instruction file.
- Use \`${routes.manifestFile}\` as the machine-readable routing contract.
- Use \`${routes.projectFile}\` for stable repo-wide context.
- Keep accepted product behavior, contracts, and invariants in \`${routes.specsRoot}/\`.
- Keep in-flight accepted-truth edits in \`${routes.changesRoot}/<slug>/specs/\`.
- Keep durable debugging, implementation, and operations notes in \`${routes.knowledgeRoot}/\`.
- Use repo-local skills from \`${routes.repoSkillsRoot}/\` only.
- Run a knowledge retrieval pass before major decisions in explore, plan, and review.
- Prefer the core workflow \`${routes.workflow.join(" -> ")}\`.
- Use review as an optional gate before apply or closure when risk, ambiguity, or findings warrant it.
- Run sync and re-verify only when staged specs change accepted truth.
- Use learn/refresh only when durable knowledge should change.
- Update \`${routes.knowledgeRoot}/index.md\` whenever a knowledge note is created, consolidated, replaced, or removed.
- Do not mirror accepted product truth into knowledge notes.
`;
}
