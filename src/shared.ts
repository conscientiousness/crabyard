import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type ManagedBlockMarker = {
  start: string;
  end: string;
};

export type CliIO = {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

export type InstallOptions = {
  repoPath: string;
  primaryDocs: string[];
  tags: string[];
  skipRepo: boolean;
  dryRun: boolean;
  backup: boolean;
};

export type ParsedManifest = {
  root?: string;
  projectFile?: string;
  taskFormatFile?: string;
  instructionsFile?: string;
  specsRoot?: string;
  changesRoot?: string;
  knowledgeRoot?: string;
  knowledgeIndex?: string;
  repoSkillsRoot?: string;
};

export type RepoContext = {
  repoPath: string;
  rootDir: string;
  rootPath: string;
  manifestPath: string;
  projectFilePath: string;
  taskFormatPath: string;
  instructionsPath: string;
  specsRootPath: string;
  changesRootPath: string;
  knowledgeRootPath: string;
  knowledgeIndexPath: string;
  repoSkillsPath: string;
  hasManifest: boolean;
};

export type ListTarget = "all" | "specs" | "changes" | "knowledge";

export const PRODUCT_NAME = "Crabyard";
export const PACKAGE_NAME = "crabyard";
export const PACKAGE_VERSION = "2026.4.8";
export const BACKUP_DIRNAME = ".crabyard";
export const ROOT_DIRNAME = "crabyard";
export const MANIFEST_FILE = "manifest.yaml";
export const PROJECT_FILE = "project.md";
export const TASK_FORMAT_FILE = "TASK_EXECUTION_FORMAT.md";
export const KNOWLEDGE_INDEX_FILE = "knowledge/index.md";
export const REPO_SKILLS_DIR = ".agents/skills";
export const INSTRUCTIONS_FILE = "AGENTS.md";
export const CHANGE_ARTIFACT_FILES = ["proposal.md", "design.md", "tasks.md", "execution.yaml"] as const;
export const CHANGE_REQUIRED_DIRECTORIES = ["specs"] as const;
export const REPO_SKILL_NAMES = [
  "crabyard-research",
  "crabyard-explore",
  "crabyard-plan",
  "crabyard-apply",
  "crabyard-review",
  "crabyard-archive",
  "crabyard-debug",
  "crabyard-learn",
  "crabyard-refresh",
] as const;

export const PRIMARY_AGENTS_BLOCK: ManagedBlockMarker = {
  start: "<!-- crabyard:memory:start -->",
  end: "<!-- crabyard:memory:end -->",
};

export const LEGACY_AGENTS_BLOCKS: ManagedBlockMarker[] = [
  PRIMARY_AGENTS_BLOCK,
  {
    start: "<!-- agent-relayflow:memory:start -->",
    end: "<!-- agent-relayflow:memory:end -->",
  },
  {
    start: "<!-- openspec-compound-kit:compound-memory:start -->",
    end: "<!-- openspec-compound-kit:compound-memory:end -->",
  },
];

export function defaultCliIO(): CliIO {
  return {
    cwd: process.cwd(),
    stdout: (value) => console.log(value),
    stderr: (value) => console.error(value),
  };
}

export function isListTarget(value: string): value is ListTarget {
  return value === "all" || value === "specs" || value === "changes" || value === "knowledge";
}

export function toBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function formatYamlList(items: string[], indent: number): string {
  const prefix = " ".repeat(indent);
  return items.map((item) => `${prefix}- ${item}`).join("\n");
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findDuplicates(items: string[]): string[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([item]) => item)
    .sort();
}

export function resolveRepoRelative(repoPath: string, targetPath: string): string {
  const repoRoot = resolve(repoPath);
  const resolved = targetPath.startsWith("/") ? resolve(targetPath) : resolve(repoRoot, targetPath);
  const relativePath = relative(repoRoot, resolved);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolved;
  }

  throw new Error(`Manifest path must stay inside the repo root: ${targetPath}`);
}

export function createTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export function createDateStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function walkFiles(rootPath: string): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

export async function listMarkdownFiles(rootPath: string, ignoredBasenames: Set<string>): Promise<string[]> {
  const files = await walkFiles(rootPath);

  return files
    .filter((filePath) => filePath.endsWith(".md"))
    .filter((filePath) => !ignoredBasenames.has(basename(filePath)))
    .sort();
}

export function wrapManagedContent(filePath: string, content: string): string {
  if (filePath.endsWith(".md")) {
    return `<!-- Managed by ${PACKAGE_NAME} -->\n\n${content.trimEnd()}\n`;
  }
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return `# Managed by ${PACKAGE_NAME}\n${content.trimEnd()}\n`;
  }
  return `${content.trimEnd()}\n`;
}

export function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatValidationErrors(prefix: string, errors: string[]): string {
  return `${prefix}\n${errors.map((error) => `- ${error}`).join("\n")}`;
}

export function printSection(io: CliIO, title: string, items: string[]) {
  io.stdout(`${title} (${items.length})`);
  if (items.length === 0) {
    io.stdout("- None");
  } else {
    for (const item of items) {
      io.stdout(`- ${item}`);
    }
  }
  io.stdout("");
}

export function printValidationResult(io: CliIO, errors: string[], targetLabel = "Repo") {
  if (errors.length === 0) {
    io.stdout(`${targetLabel} validation passed.`);
    return;
  }

  io.stderr(formatValidationErrors(`${targetLabel} validation failed.`, errors));
}
