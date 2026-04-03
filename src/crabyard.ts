import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";
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
  VerifyCheck,
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

type ChangeStatusReport = {
  kind: "change-status";
  repoPath: string;
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

  switch (command) {
    case "init":
    case "install":
      await runInit(rest, io);
      return;
    case "update":
      await runUpdate(rest, io);
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
    case "verify":
      await runVerify(rest, io);
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
  init [repo-path] [options]               Bootstrap Crabyard into a repo
  install [repo-path] [options]            Alias for init
  update [repo-path] [options]             Refresh managed Crabyard repo assets
  list [all|specs|changes|knowledge]       List tracked repo artifacts
  show <target> [name]                     Show manifest, project, spec, change, or knowledge
  validate [repo]                          Validate the repo structure and active changes
  validate change <name>                   Validate a single change bundle
  status [change]                          Show repo status or execution status for a change
  verify <change>                          Run the deterministic read-only gate for a change
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
  pnpm exec tsx src/index.ts update /absolute/path/to/repo
  node dist/index.js list specs --repo /absolute/path/to/repo
  node dist/index.js verify add-auth --repo /absolute/path/to/repo
  node dist/index.js sync add-auth --repo /absolute/path/to/repo
  node dist/index.js archive add-auth --repo /absolute/path/to/repo

Init options:
  --primary-docs <comma-separated-paths>
  --tags <comma-separated-tags>
  --skip-repo
  --dry-run

Update options:
  --primary-docs <comma-separated-paths>
  --tags <comma-separated-tags>
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

async function runUpdate(args: string[], io: CliIO) {
  await runRepoAssetCommand("update", args, io);
}

async function runRepoAssetCommand(mode: "init" | "update", args: string[], io: CliIO) {
  const options = parseInstallArgs(args, io.cwd);
  if (mode === "update" && options.skipRepo) {
    throw new Error("The update command does not support --skip-repo.");
  }

  const repoPath = resolve(options.repoPath);
  const repoName = basename(repoPath);
  const existingMetadata = mode === "update" ? await readRepoInstallMetadata(repoPath) : null;
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

  io.stdout(mode === "init" ? `Initializing ${PRODUCT_NAME}` : `Updating ${PRODUCT_NAME}`);
  io.stdout(`Repo: ${repoPath}`);
  io.stdout(`Source docs: ${primaryDocs.join(", ")}`);
  io.stdout(`Tags: ${tags.join(", ")}`);

  if (!options.skipRepo) {
    await installRepoAssets({
      repoPath,
      primaryDocs,
      tags,
      dryRun: options.dryRun,
      timestamp,
      io,
    });
  }

  io.stdout(mode === "init" ? "Init complete." : "Update complete.");
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

  if (positional.length === 0 || (positional.length === 1 && positional[0] === "repo")) {
    const errors = await validateRepo(context);
    if (errors.length > 0) {
      if (json) {
        printJson(io, {
          kind: "validate-repo",
          repoPath: context.repoPath,
          valid: false,
          errors,
        });
      }
      throw new Error(formatValidationErrors("Repo validation failed.", errors));
    }
    if (json) {
      printJson(io, {
        kind: "validate-repo",
        repoPath: context.repoPath,
        valid: true,
        errors: [],
      });
      return;
    }
    io.stdout("Repo validation passed.");
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
          valid: false,
          errors: result.errors,
        });
      }
      throw new Error(formatValidationErrors(`Change ${basename(changeDir)} validation failed.`, result.errors));
    }
    if (json) {
      printJson(io, {
        kind: "validate-change",
        repoPath: context.repoPath,
        change: basename(changeDir),
        valid: true,
        errors: [],
      });
      return;
    }
    io.stdout(`Change ${basename(changeDir)} validation passed.`);
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

  io.stdout(`Change ${report.change.name} verified.`);
  if (report.sync.pendingCount > 0) {
    io.stdout(`Sync required: ${report.sync.pendingCount} staged spec file(s) differ from accepted specs.`);
  } else {
    io.stdout("Sync state coherent.");
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
    io.stdout(`Change ${basename(changeDir)} is already sync-coherent.`);
    return;
  }

  for (const entry of plan.pending) {
    await mkdir(dirname(entry.targetPath), { recursive: true });
    const content = await readFile(entry.sourcePath);
    await writeFile(entry.targetPath, content);
  }

  io.stdout(`Synced ${plan.pending.length} spec file(s) for ${basename(changeDir)}.`);
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
    io.stdout(`[dry-run] archive ${relative(context.repoPath, verification.changeDir)} -> ${relative(context.repoPath, archiveDir)}`);
    return;
  }

  await mkdir(archiveRoot, { recursive: true });
  await rename(verification.changeDir, archiveDir);
  io.stdout(`Archived ${basename(verification.changeDir)} -> ${archiveDir}`);
}

function parseInstallArgs(args: string[], cwd: string): InstallOptions {
  let repoPath = cwd;
  let primaryDocs: string[] = [];
  let tags: string[] = [];
  let skipRepo = false;
  let dryRun = false;
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

async function readRepoInstallMetadata(repoPath: string): Promise<{ primaryDocs: string[]; tags: string[] } | null> {
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
    manifestPath: resolveRepoRelative(repoPath, join(rootDir, MANIFEST_FILE)),
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
  dryRun: boolean;
  timestamp: string;
  io: CliIO;
}) {
  const backupRoot = join(args.repoPath, BACKUP_DIRNAME, "backups", args.timestamp);

  args.io.stdout(`Installing repo assets -> ${args.repoPath}`);

  for (const skillName of REPO_SKILL_NAMES) {
    await copyManagedPath({
      sourcePath: join(REPO_ASSETS_ROOT, REPO_SKILLS_DIR, skillName),
      targetPath: join(args.repoPath, REPO_SKILLS_DIR, skillName),
      backupRoot,
      baseRoot: args.repoPath,
      dryRun: args.dryRun,
      io: args.io,
    });
  }

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, PROJECT_FILE),
    content: buildProjectFile(args.primaryDocs, args.tags),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, MANIFEST_FILE),
    content: buildManifest(args.primaryDocs, args.tags),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, TASK_FORMAT_FILE),
    content: await readFile(join(REPO_ASSETS_ROOT, ROOT_DIRNAME, TASK_FORMAT_FILE), "utf8"),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, "specs", "README.md"),
    content: buildBucketReadme(
      "Specs",
      "Store accepted product behavior, contracts, and invariants here. Sync staged change specs into this tree with `crabyard sync <change>`.",
    ),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, "changes", "README.md"),
    content: buildChangesReadme(),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await writeManagedFile({
    filePath: join(args.repoPath, ROOT_DIRNAME, KNOWLEDGE_INDEX_FILE),
    content: buildKnowledgeIndex(),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });

  await updateAgentsFile({
    filePath: join(args.repoPath, INSTRUCTIONS_FILE),
    content: buildAgentsBlock(),
    backupRoot,
    baseRoot: args.repoPath,
    dryRun: args.dryRun,
    io: args.io,
  });
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

  io.stdout(`=== ${relative(repoPath, filePath)} ===`);
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
    io.stdout(`=== ${relative(repoPath, filePath)} ===`);
    io.stdout(content.trimEnd());
    io.stdout("");
  }
}

async function buildRepoStatus(context: RepoContext): Promise<RepoStatusReport> {
  const [validationErrors, specs, knowledge, activeChanges, archivedChanges] = await Promise.all([
    validateRepo(context),
    listSpecEntries(context),
    listKnowledgeEntries(context),
    listActiveChangeEntries(context),
    listArchivedChangeEntries(context),
  ]);

  const activeChangeReports = await Promise.all(activeChanges.map((changeName) => buildChangeStatus(context, changeName)));

  return {
    kind: "repo-status",
    repoPath: context.repoPath,
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

async function buildChangeStatus(context: RepoContext, changeName: string): Promise<ChangeStatusReport> {
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
  io.stdout(`Repo: ${report.repoPath}`);
  io.stdout(`Validation: ${report.validation.valid ? "valid" : "invalid"}`);
  io.stdout(
    `Counts: ${report.counts.activeChanges} active change(s), ${report.counts.archivedChanges} archived, ${report.counts.specs} spec file(s), ${report.counts.knowledge} knowledge note(s)`,
  );

  if (report.validation.errors.length > 0) {
    io.stdout("Validation Errors:");
    for (const error of report.validation.errors) {
      io.stdout(`- ${error}`);
    }
  }

  if (report.activeChanges.length === 0) {
    io.stdout("Active Changes: none");
    return;
  }

  io.stdout("Active Changes:");
  for (const change of report.activeChanges) {
    io.stdout(`- ${change.name}: ${change.state}; ready units=${change.readyUnits}; pending sync=${change.pendingSync}`);
  }
}

function printChangeStatus(report: ChangeStatusReport, io: CliIO) {
  io.stdout(`Change: ${report.change.name}`);
  io.stdout(`Path: ${report.change.path}`);
  io.stdout(`State: ${report.state}`);
  io.stdout(
    `Tasks: ${report.tasks.completedSections}/${report.tasks.totalSections} sections complete; ${report.tasks.checkedCheckboxes}/${report.tasks.totalCheckboxes} checkbox items checked`,
  );
  io.stdout(
    `Units: ${report.units.complete}/${report.units.total} complete; ${report.units.ready} ready; ${report.units.blocked} blocked; ${report.units.pending} pending`,
  );
  io.stdout(
    `Verify: ${report.verification.summary.totalChecks} check(s); ready frontier has ${report.verification.summary.readyUnitChecks} check(s) across ${report.frontier.readyUnits.length} unit(s)`,
  );
  io.stdout(report.sync.coherent ? "Sync: coherent" : `Sync: ${report.sync.pendingCount} staged spec file(s) pending`);

  if (!report.validation.valid) {
    io.stdout("Validation Errors:");
    for (const error of report.validation.errors) {
      io.stdout(`- ${error}`);
    }
  }

  if (report.frontier.readyUnits.length > 0) {
    io.stdout("Ready Units:");
    for (const unit of report.frontier.readyUnits) {
      io.stdout(`- ${unit.id} ${unit.title}`);
      for (const check of unit.verify) {
        io.stdout(`  verify: ${formatVerifyCheck(check)}`);
      }
    }
  }

  if (report.frontier.blockedUnits.length > 0) {
    io.stdout("Blocked Units:");
    for (const unit of report.frontier.blockedUnits) {
      io.stdout(`- ${unit.id} ${unit.title} <- ${unit.blockedBy.join(", ")}`);
    }
  }

  if (!report.verification.ready) {
    io.stdout("Verification Gaps:");
    for (const error of report.verification.errors) {
      io.stdout(`- ${error}`);
    }
  }
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
    args.io.stdout(`[dry-run] update ${args.filePath}`);
    return;
  }

  if ((await pathExists(args.filePath)) && existing !== nextContent) {
    await backupExisting(args.filePath, args.backupRoot, args.baseRoot, false, args.io);
  }

  await mkdir(dirname(args.filePath), { recursive: true });
  await writeFile(args.filePath, nextContent, "utf8");
  args.io.stdout(`updated ${args.filePath}`);
}

async function writeManagedFile(args: {
  filePath: string;
  content: string;
  backupRoot: string;
  baseRoot: string;
  dryRun: boolean;
  io: CliIO;
}) {
  const wrapped = wrapManagedContent(args.filePath, args.content);
  const exists = await pathExists(args.filePath);

  if (exists) {
    const previous = await readFile(args.filePath, "utf8");
    if (previous === wrapped) {
      args.io.stdout(`unchanged ${args.filePath}`);
      return;
    }
    await backupExisting(args.filePath, args.backupRoot, args.baseRoot, args.dryRun, args.io);
  }

  if (args.dryRun) {
    args.io.stdout(`[dry-run] write ${args.filePath}`);
    return;
  }

  await mkdir(dirname(args.filePath), { recursive: true });
  await writeFile(args.filePath, wrapped, "utf8");
  args.io.stdout(`wrote ${args.filePath}`);
}

async function copyManagedPath(args: {
  sourcePath: string;
  targetPath: string;
  backupRoot: string;
  baseRoot: string;
  dryRun: boolean;
  io: CliIO;
}) {
  if (!(await pathExists(args.sourcePath))) {
    throw new Error(`Missing installer asset: ${args.sourcePath}`);
  }

  if (await pathExists(args.targetPath)) {
    await backupExisting(args.targetPath, args.backupRoot, args.baseRoot, args.dryRun, args.io);
    if (!args.dryRun) {
      await rm(args.targetPath, { recursive: true, force: true });
    }
  }

  if (args.dryRun) {
    args.io.stdout(`[dry-run] copy ${args.sourcePath} -> ${args.targetPath}`);
    return;
  }

  await mkdir(dirname(args.targetPath), { recursive: true });
  await cp(args.sourcePath, args.targetPath, { recursive: true });
  args.io.stdout(`copied ${args.targetPath}`);
}

async function backupExisting(targetPath: string, backupRoot: string, baseRoot: string, dryRun: boolean, io: CliIO) {
  const backupPath = join(backupRoot, relative(baseRoot, targetPath));

  if (dryRun) {
    io.stdout(`[dry-run] backup ${targetPath} -> ${backupPath}`);
    return;
  }

  await mkdir(dirname(backupPath), { recursive: true });
  await cp(targetPath, backupPath, { recursive: true });
  io.stdout(`backed up ${targetPath} -> ${backupPath}`);
}

function buildProjectFile(primaryDocs: string[], tags: string[]): string {
  return `# Project Context

This file stores stable repo context for Crabyard agents. Keep it concise and durable.

## Source Docs

${toBulletList(primaryDocs)}

## Default Tags

${toBulletList(tags.map((tag) => `\`${tag}\``))}

## Guidance

- Prefer \`${ROOT_DIRNAME}/specs/\` for accepted product truth.
- Prefer \`${ROOT_DIRNAME}/changes/<slug>/specs/\` for in-flight accepted-truth edits that still need sync.
- Prefer \`${ROOT_DIRNAME}/knowledge/\` for durable debugging, implementation, and operations notes.
- Run a knowledge retrieval pass before major decisions in explore, plan, and review.
- Use the workflow \`research -> explore -> plan -> review -> apply -> review -> verify -> sync -> verify -> archive -> learn/refresh\`.
- Update this file only for stable repo-wide context, not task-by-task status.
`;
}

function buildManifest(primaryDocs: string[], tags: string[]): string {
  return `version: 1
root: ${ROOT_DIRNAME}
project_file: ${ROOT_DIRNAME}/${PROJECT_FILE}
task_format_file: ${ROOT_DIRNAME}/${TASK_FORMAT_FILE}
instructions_file: ${INSTRUCTIONS_FILE}

specs_root: ${ROOT_DIRNAME}/specs
changes_root: ${ROOT_DIRNAME}/changes

knowledge:
  root: ${ROOT_DIRNAME}/knowledge
  index: ${ROOT_DIRNAME}/${KNOWLEDGE_INDEX_FILE}

skills:
  canonical_root: ${REPO_SKILLS_DIR}

source_docs:
${formatYamlList(primaryDocs, 2)}

workflow:
  - research
  - explore
  - plan
  - review
  - apply
  - review
  - verify
  - sync
  - verify
  - archive
  - learn
  - refresh

refresh_scope:
  - ${ROOT_DIRNAME}/knowledge

write_policy:
  forbid_paths:
    - CLAUDE.md
  mutate_agents_only_when_routing_changes: true

default_tags:
${formatYamlList(tags, 2)}

notes:
  - Keep accepted product behavior and contracts in ${ROOT_DIRNAME}/specs.
  - Keep in-flight accepted-truth edits in ${ROOT_DIRNAME}/changes/<slug>/specs.
  - Keep durable implementation and debugging notes in ${ROOT_DIRNAME}/knowledge.
  - Use retrieval from ${ROOT_DIRNAME}/knowledge before major decisions in explore, plan, and review.
  - Treat ${INSTRUCTIONS_FILE} as the canonical repo-instruction file.
`;
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

## Entries

- None yet.
`;
}

function buildAgentsBlock(): string {
  return `## Crabyard Memory
- Treat \`${INSTRUCTIONS_FILE}\` as the canonical repo-instruction file.
- Use \`${ROOT_DIRNAME}/${MANIFEST_FILE}\` as the machine-readable routing contract.
- Use \`${ROOT_DIRNAME}/${PROJECT_FILE}\` for stable repo-wide context.
- Keep accepted product behavior, contracts, and invariants in \`${ROOT_DIRNAME}/specs/\`.
- Keep in-flight accepted-truth edits in \`${ROOT_DIRNAME}/changes/<slug>/specs/\`.
- Keep durable debugging, implementation, and operations notes in \`${ROOT_DIRNAME}/knowledge/\`.
- Use repo-local skills from \`${REPO_SKILLS_DIR}/\` only.
- Run a knowledge retrieval pass before major decisions in explore, plan, and review.
- Prefer the workflow \`research -> explore -> plan -> review -> apply -> review -> verify -> sync -> verify -> archive -> learn/refresh\`.
- Update \`${ROOT_DIRNAME}/${KNOWLEDGE_INDEX_FILE}\` whenever a knowledge note is created, consolidated, replaced, or removed.
- Do not mirror accepted product truth into knowledge notes.
`;
}
