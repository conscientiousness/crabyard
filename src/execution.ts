import { basename } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import { findDuplicates, formatValidationErrors } from "./shared.js";

const executionUnitSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    parallel: z.boolean(),
    depends_on: z.array(z.string().trim().min(1)),
    writes: z.array(z.string().trim().min(1)).min(1),
    verify: z.array(z.unknown()).min(1),
    notes: z.string().trim().min(1).optional(),
    allow_parallel_write_overlap: z.boolean().optional(),
  })
  .strict();

const executionSchema = z
  .object({
    version: z.literal(1),
    tasks_file: z.string().trim().min(1),
    units: z.array(executionUnitSchema).min(1),
  })
  .strict();

export type VerifyCommandCheck = {
  kind: "command";
  run?: string;
  argv?: string[];
  cwd?: string;
  timeoutMs?: number;
  expectExitCode: number;
};

export type VerifyArtifactCheck = {
  kind: "artifact";
  path: string;
  state: "exists" | "missing";
  notes?: string;
};

export type VerifyCheck = VerifyCommandCheck | VerifyArtifactCheck;

export type ExecutionUnit = {
  id: string;
  title: string;
  parallel: boolean;
  dependsOn: string[];
  writes: string[];
  verify: VerifyCheck[];
  notes?: string;
  allowParallelWriteOverlap: boolean;
};

export type ParsedExecution = {
  version: 1;
  tasksFile: string;
  units: ExecutionUnit[];
};

export type ParsedExecutionResult = {
  execution: ParsedExecution | null;
  errors: string[];
};

export type TaskSection = {
  title: string;
  normalizedTitle: string;
  lines: string[];
  checkboxCount: number;
  checkedCount: number;
  uncheckedCount: number;
  complete: boolean;
};

type Range = {
  start: number;
  end: number;
};

type CharMatcher = {
  ranges: Range[];
  negated: boolean;
};

type SegmentToken =
  | { kind: "star" }
  | { kind: "match"; matcher: CharMatcher };

type SegmentPattern = {
  raw: string;
  tokens: SegmentToken[];
};

type PathToken =
  | { kind: "globstar" }
  | { kind: "segment"; pattern: SegmentPattern };

type ParsedWritePattern = {
  raw: string;
  normalized: string;
  tokens: PathToken[];
};

type WritePatternParseResult =
  | { ok: true; variants: ParsedWritePattern[] }
  | { ok: false; error: string };

const SEGMENT_ALPHABET: Range[] = [
  { start: 0, end: 46 },
  { start: 48, end: 0x10ffff },
];

export function extractTaskHeadings(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}

export function normalizeTaskTitle(value: string): string {
  return value.replace(/^\d+[\.\)]\s*/, "").trim();
}

export function parseTaskSections(content: string): TaskSection[] {
  const sections: TaskSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const pushSection = () => {
    if (!currentTitle) {
      return;
    }

    const checkboxCount = currentLines.filter((line) => /- \[[ xX]\]/.test(line)).length;
    const checkedCount = currentLines.filter((line) => /- \[[xX]\]/.test(line)).length;
    const uncheckedCount = currentLines.filter((line) => /- \[ \]/.test(line)).length;

    sections.push({
      title: currentTitle,
      normalizedTitle: normalizeTaskTitle(currentTitle),
      lines: currentLines,
      checkboxCount,
      checkedCount,
      uncheckedCount,
      complete: checkboxCount > 0 && uncheckedCount === 0,
    });
  };

  for (const line of content.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      pushSection();
      currentTitle = line.replace(/^##\s+/, "").trim();
      currentLines = [];
      continue;
    }

    if (currentTitle) {
      currentLines.push(line);
    }
  }

  pushSection();
  return sections;
}

export function hasUncheckedTasks(content: string): boolean {
  return content.split(/\r?\n/).some((line) => line.includes("- [ ]"));
}

export function parseExecutionYaml(content: string): ParsedExecutionResult {
  const document = parseDocument(content);
  const parseErrors = document.errors.map((error) => error.message);

  if (parseErrors.length > 0) {
    return {
      execution: null,
      errors: parseErrors.map((error) => `execution.yaml parse error: ${error}`),
    };
  }

  const parsed = executionSchema.safeParse(document.toJS());

  if (!parsed.success) {
    return {
      execution: null,
      errors: parsed.error.issues.map(formatExecutionIssue),
    };
  }

  const normalizationErrors: string[] = [];
  const units: ExecutionUnit[] = [];

  for (let index = 0; index < parsed.data.units.length; index += 1) {
    const unit = parsed.data.units[index];
    const normalizedVerify = normalizeVerifyEntries(unit.verify, index + 1);

    if (!normalizedVerify.ok) {
      normalizationErrors.push(...normalizedVerify.errors);
      continue;
    }

    units.push({
      id: unit.id,
      title: unit.title,
      parallel: unit.parallel,
      dependsOn: unit.depends_on,
      writes: unit.writes,
      verify: normalizedVerify.verify,
      notes: unit.notes,
      allowParallelWriteOverlap: unit.allow_parallel_write_overlap ?? false,
    });
  }

  if (normalizationErrors.length > 0) {
    return {
      execution: null,
      errors: normalizationErrors,
    };
  }

  return {
    execution: {
      version: parsed.data.version,
      tasksFile: parsed.data.tasks_file,
      units,
    },
    errors: [],
  };
}

export function validateExecutionAgainstTasks(changeDir: string, headings: string[], execution: ParsedExecution): string[] {
  const errors: string[] = [];
  const normalizedHeadings = headings.map(normalizeTaskTitle);
  const normalizedUnitTitles = execution.units.map((unit) => normalizeTaskTitle(unit.title));
  const unitIds = execution.units.map((unit) => unit.id);
  const parsedWritesByUnit = new Map<string, ParsedWritePattern[]>();

  for (const duplicateHeading of findDuplicates(normalizedHeadings)) {
    errors.push(`tasks.md contains duplicate top-level task sections: ${duplicateHeading}`);
  }

  for (const duplicateId of findDuplicates(unitIds)) {
    errors.push(`execution.yaml contains duplicate unit id: ${duplicateId}`);
  }

  for (const duplicateTitle of findDuplicates(normalizedUnitTitles)) {
    errors.push(`execution.yaml contains duplicate unit title: ${duplicateTitle}`);
  }

  if (execution.tasksFile !== "tasks.md" || basename(execution.tasksFile) !== "tasks.md") {
    errors.push(`execution.yaml tasks_file must be exactly tasks.md, found ${execution.tasksFile}`);
  }

  if (normalizedHeadings.length !== execution.units.length) {
    errors.push(
      `execution.yaml unit count ${execution.units.length} does not match tasks.md top-level section count ${normalizedHeadings.length} in ${changeDir}/tasks.md`,
    );
  }

  const pairedLength = Math.min(normalizedHeadings.length, normalizedUnitTitles.length);
  for (let index = 0; index < pairedLength; index += 1) {
    if (normalizedHeadings[index] !== normalizedUnitTitles[index]) {
      errors.push(
        `execution.yaml unit ${execution.units[index]?.id ?? `#${index + 1}`} title "${normalizedUnitTitles[index]}" does not match tasks.md section "${normalizedHeadings[index]}" at position ${index + 1}`,
      );
    }
  }

  const unitIdSet = new Set(unitIds);
  for (const unit of execution.units) {
    for (const dependency of unit.dependsOn) {
      if (!unitIdSet.has(dependency)) {
        errors.push(`execution.yaml unit ${unit.id} has unknown depends_on target: ${dependency}`);
      }
    }

    const parsedWrites: ParsedWritePattern[] = [];
    for (const write of unit.writes) {
      const parsedWrite = parseWritePattern(write);
      if (!parsedWrite.ok) {
        errors.push(`execution.yaml unit ${unit.id} has invalid write pattern "${write}": ${parsedWrite.error}`);
        continue;
      }
      parsedWrites.push(...parsedWrite.variants);
    }
    parsedWritesByUnit.set(unit.id, parsedWrites);
  }

  const dependencyCycle = findDependencyCycle(execution.units);
  if (dependencyCycle) {
    errors.push(`execution.yaml contains a dependency cycle: ${dependencyCycle.join(" -> ")}`);
  }

  const dependencyClosure = buildDependencyClosure(execution.units);
  for (let leftIndex = 0; leftIndex < execution.units.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < execution.units.length; rightIndex += 1) {
      const left = execution.units[leftIndex];
      const right = execution.units[rightIndex];

      if (!left.parallel || !right.parallel) {
        continue;
      }

      if (dependencyClosure.get(left.id)?.has(right.id) || dependencyClosure.get(right.id)?.has(left.id)) {
        continue;
      }

      const leftWrites = parsedWritesByUnit.get(left.id) ?? [];
      const rightWrites = parsedWritesByUnit.get(right.id) ?? [];

      if (leftWrites.length === 0 || rightWrites.length === 0) {
        continue;
      }

      if (!writesOverlap(leftWrites, rightWrites)) {
        continue;
      }

      if (left.allowParallelWriteOverlap && right.allowParallelWriteOverlap) {
        continue;
      }

      errors.push(
        `execution.yaml units ${left.id} and ${right.id} declare overlapping writes while parallel: true; set allow_parallel_write_overlap: true on both units to opt out explicitly`,
      );
    }
  }

  return errors;
}

export function assertValidExecution(content: string, headings: string[], changeDir: string): ParsedExecution {
  const parsed = parseExecutionYaml(content);
  const errors = [...parsed.errors];

  if (parsed.execution) {
    errors.push(...validateExecutionAgainstTasks(changeDir, headings, parsed.execution));
  }

  if (errors.length > 0 || !parsed.execution) {
    throw new Error(formatValidationErrors("Invalid execution.yaml", errors));
  }

  return parsed.execution;
}

function normalizeVerifyEntries(
  entries: unknown[],
  unitNumber: number,
): { ok: true; verify: VerifyCheck[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const verify: VerifyCheck[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const label = `execution.yaml unit #${unitNumber} verify #${index + 1}`;
    const normalized = normalizeVerifyEntry(entries[index], label);
    if (!normalized.ok) {
      errors.push(normalized.error);
      continue;
    }
    verify.push(normalized.verify);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, verify };
}

function normalizeVerifyEntry(entry: unknown, label: string): { ok: true; verify: VerifyCheck } | { ok: false; error: string } {
  if (typeof entry === "string") {
    const run = entry.trim();
    if (!run) {
      return { ok: false, error: `${label} must not be empty` };
    }

    return {
      ok: true,
      verify: {
        kind: "command",
        run,
        expectExitCode: 0,
      },
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: `${label} must be a string or object` };
  }

  const record = entry as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";

  switch (kind) {
    case "command":
      return normalizeCommandVerify(record, label);
    case "artifact":
      return normalizeArtifactVerify(record, label);
    default:
      return { ok: false, error: `${label} kind must be one of: command, artifact` };
  }
}

function normalizeCommandVerify(
  record: Record<string, unknown>,
  label: string,
): { ok: true; verify: VerifyCommandCheck } | { ok: false; error: string } {
  const allowedKeys = new Set(["kind", "run", "argv", "cwd", "timeout_ms", "expect_exit_code"]);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    return { ok: false, error: `${label} command has unknown field(s): ${unexpected.join(", ")}` };
  }

  const run = record.run;
  const argv = record.argv;
  const hasRun = typeof run === "string" && run.trim().length > 0;
  const hasArgv = Array.isArray(argv) && argv.length > 0;

  if (hasRun === hasArgv) {
    return { ok: false, error: `${label} command must define exactly one of run or argv` };
  }

  if (run !== undefined && !hasRun) {
    return { ok: false, error: `${label} command run must be a non-empty string` };
  }

  let normalizedArgv: string[] | undefined;
  if (argv !== undefined) {
    if (!Array.isArray(argv) || argv.length === 0) {
      return { ok: false, error: `${label} command argv must be a non-empty string array` };
    }

    normalizedArgv = [];
    for (const arg of argv) {
      if (typeof arg !== "string" || arg.trim().length === 0) {
        return { ok: false, error: `${label} command argv must contain only non-empty strings` };
      }
      normalizedArgv.push(arg.trim());
    }
  }

  const cwd = record.cwd;
  if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim().length === 0)) {
    return { ok: false, error: `${label} command cwd must be a non-empty string when provided` };
  }

  const timeoutMs = record.timeout_ms;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || (timeoutMs as number) <= 0)) {
    return { ok: false, error: `${label} command timeout_ms must be a positive integer when provided` };
  }

  const expectExitCode = record.expect_exit_code;
  if (expectExitCode !== undefined && (!Number.isInteger(expectExitCode) || (expectExitCode as number) < 0)) {
    return { ok: false, error: `${label} command expect_exit_code must be a non-negative integer when provided` };
  }

  return {
    ok: true,
    verify: {
      kind: "command",
      run: hasRun ? (run as string).trim() : undefined,
      argv: normalizedArgv,
      cwd: typeof cwd === "string" ? cwd.trim() : undefined,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
      expectExitCode: typeof expectExitCode === "number" ? expectExitCode : 0,
    },
  };
}

function normalizeArtifactVerify(
  record: Record<string, unknown>,
  label: string,
): { ok: true; verify: VerifyArtifactCheck } | { ok: false; error: string } {
  const allowedKeys = new Set(["kind", "path", "state", "notes"]);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    return { ok: false, error: `${label} artifact has unknown field(s): ${unexpected.join(", ")}` };
  }

  const path = record.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return { ok: false, error: `${label} artifact path must be a non-empty string` };
  }

  const state = record.state;
  if (state !== undefined && state !== "exists" && state !== "missing") {
    return { ok: false, error: `${label} artifact state must be either exists or missing` };
  }

  const notes = record.notes;
  if (notes !== undefined && (typeof notes !== "string" || notes.trim().length === 0)) {
    return { ok: false, error: `${label} artifact notes must be a non-empty string when provided` };
  }

  return {
    ok: true,
    verify: {
      kind: "artifact",
      path: path.trim(),
      state: state === "missing" ? "missing" : "exists",
      notes: typeof notes === "string" ? notes.trim() : undefined,
    },
  };
}

function formatExecutionIssue(issue: z.ZodIssue): string {
  const path = issue.path;

  if (path[0] === "units" && typeof path[1] === "number" && typeof path[2] === "string") {
    const unitLabel = `unit #${path[1] + 1}`;
    const field = path[2];

    if (issue.code === "invalid_type" && issue.input === undefined) {
      switch (field) {
        case "parallel":
          return `execution.yaml ${unitLabel} is missing parallel`;
        case "writes":
          return `execution.yaml ${unitLabel} is missing writes`;
        case "verify":
          return `execution.yaml ${unitLabel} is missing verify`;
        case "depends_on":
          return `execution.yaml ${unitLabel} is missing depends_on`;
        default:
          return `execution.yaml ${unitLabel} is missing ${field}`;
      }
    }

    if (field === "writes" || field === "verify") {
      return `execution.yaml ${unitLabel} must define at least one ${field} entry`;
    }

    return `execution.yaml ${unitLabel} has invalid ${field}: ${issue.message}`;
  }

  if (path.length === 1 && typeof path[0] === "string") {
    if (issue.code === "invalid_type" && issue.input === undefined) {
      return `execution.yaml is missing ${path[0]}`;
    }
    return `execution.yaml has invalid ${path[0]}: ${issue.message}`;
  }

  return `execution.yaml validation error: ${issue.message}`;
}

function findDependencyCycle(units: ExecutionUnit[]): string[] | null {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const startIndex = stack.indexOf(id);
      return [...stack.slice(startIndex), id];
    }

    if (visited.has(id)) {
      return null;
    }

    const unit = unitsById.get(id);
    if (!unit) {
      return null;
    }

    visiting.add(id);
    stack.push(id);

    for (const dependency of unit.dependsOn) {
      const cycle = visit(dependency);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const unit of units) {
    const cycle = visit(unit.id);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

function buildDependencyClosure(units: ExecutionUnit[]): Map<string, Set<string>> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const closure = new Map<string, Set<string>>();

  const collect = (id: string): Set<string> => {
    const cached = closure.get(id);
    if (cached) {
      return cached;
    }

    const unit = unitsById.get(id);
    const result = new Set<string>();
    closure.set(id, result);

    if (!unit) {
      return result;
    }

    for (const dependency of unit.dependsOn) {
      result.add(dependency);
      for (const transitive of collect(dependency)) {
        result.add(transitive);
      }
    }

    return result;
  };

  for (const unit of units) {
    collect(unit.id);
  }

  return closure;
}

function writesOverlap(leftWrites: ParsedWritePattern[], rightWrites: ParsedWritePattern[]): boolean {
  for (const left of leftWrites) {
    for (const right of rightWrites) {
      if (writePatternOverlaps(left, right)) {
        return true;
      }
    }
  }

  return false;
}

function normalizeWritePattern(value: string): string {
  let normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");

  if (normalized.endsWith("/")) {
    normalized = `${normalized}**`;
  }

  return normalized;
}

function writePatternOverlaps(left: ParsedWritePattern, right: ParsedWritePattern): boolean {
  if (left.normalized === right.normalized) {
    return true;
  }

  return pathPatternsOverlap(left.tokens, right.tokens);
}

function parseWritePattern(value: string): WritePatternParseResult {
  const normalized = normalizeWritePattern(value);

  if (!normalized) {
    return {
      ok: false,
      error: "pattern cannot be empty",
    };
  }

  const expanded = expandBracePatterns(normalized);
  if (!expanded.ok) {
    return expanded;
  }

  const variants: ParsedWritePattern[] = [];
  for (const variant of expanded.variants) {
    const parsedVariant = parseWritePatternVariant(variant, value);
    if (!parsedVariant.ok) {
      return parsedVariant;
    }
    variants.push(parsedVariant.pattern);
  }

  return {
    ok: true,
    variants,
  };
}

function expandBracePatterns(value: string): { ok: true; variants: string[] } | { ok: false; error: string } {
  const start = findFirstBraceStart(value);
  if (start === -1) {
    return { ok: true, variants: [value] };
  }

  const end = findMatchingBraceEnd(value, start);
  if (end === -1) {
    return { ok: false, error: "unmatched `{` brace" };
  }

  const body = value.slice(start + 1, end);
  const options = splitBraceAlternatives(body);
  if (options.length < 2) {
    return { ok: false, error: "brace expansion must contain at least one comma-separated alternative" };
  }

  const prefix = value.slice(0, start);
  const suffix = value.slice(end + 1);
  const variants: string[] = [];

  for (const option of options) {
    const expanded = expandBracePatterns(`${prefix}${option}${suffix}`);
    if (!expanded.ok) {
      return expanded;
    }
    variants.push(...expanded.variants);
  }

  return {
    ok: true,
    variants,
  };
}

function findFirstBraceStart(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") {
      return index;
    }
  }

  return -1;
}

function findMatchingBraceEnd(value: string, start: number): number {
  let depth = 0;

  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "{") {
      depth += 1;
      continue;
    }

    if (value[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitBraceAlternatives(value: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of value) {
    if (character === "{") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      current += character;
      continue;
    }

    if (character === "," && depth === 0) {
      results.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  results.push(current);
  return results;
}

function parseWritePatternVariant(value: string, raw: string): { ok: true; pattern: ParsedWritePattern } | { ok: false; error: string } {
  const segments = value.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { ok: false, error: "pattern must contain at least one path segment" };
  }

  const tokens: PathToken[] = [];

  for (const segment of segments) {
    if (segment === "**") {
      tokens.push({ kind: "globstar" });
      continue;
    }

    const parsedSegment = parseSegmentPattern(segment);
    if (!parsedSegment.ok) {
      return { ok: false, error: parsedSegment.error };
    }

    tokens.push({
      kind: "segment",
      pattern: {
        raw: segment,
        tokens: parsedSegment.tokens,
      },
    });
  }

  return {
    ok: true,
    pattern: {
      raw,
      normalized: value,
      tokens,
    },
  };
}

function parseSegmentPattern(value: string): { ok: true; tokens: SegmentToken[] } | { ok: false; error: string } {
  const tokens: SegmentToken[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "*") {
      if (tokens[tokens.length - 1]?.kind !== "star") {
        tokens.push({ kind: "star" });
      }
      continue;
    }

    if (character === "?") {
      tokens.push({ kind: "match", matcher: { ranges: [...SEGMENT_ALPHABET], negated: false } });
      continue;
    }

    if (character === "[") {
      const parsedClass = parseCharacterClass(value, index);
      if (!parsedClass.ok) {
        return parsedClass;
      }
      tokens.push({ kind: "match", matcher: parsedClass.matcher });
      index = parsedClass.nextIndex;
      continue;
    }

    tokens.push({ kind: "match", matcher: createLiteralMatcher(character) });
  }

  return {
    ok: true,
    tokens,
  };
}

function parseCharacterClass(
  value: string,
  startIndex: number,
): { ok: true; matcher: CharMatcher; nextIndex: number } | { ok: false; error: string } {
  let index = startIndex + 1;
  let negated = false;

  if (value[index] === "!" || value[index] === "^") {
    negated = true;
    index += 1;
  }

  const chars: number[] = [];
  const ranges: Range[] = [];
  let sawContent = false;

  while (index < value.length && value[index] !== "]") {
    sawContent = true;

    const currentCode = value.codePointAt(index);
    if (currentCode === undefined) {
      break;
    }

    const currentChar = String.fromCodePoint(currentCode);
    const currentWidth = currentChar.length;
    const nextIndex = index + currentWidth;

    const nextChar = value[nextIndex];
    if (nextChar === "-" && value[nextIndex + 1] && value[nextIndex + 1] !== "]") {
      const rangeCode = value.codePointAt(nextIndex + 1);
      if (rangeCode === undefined) {
        return { ok: false, error: "unterminated character class range" };
      }

      ranges.push({
        start: currentCode,
        end: rangeCode,
      });

      index = nextIndex + String.fromCodePoint(rangeCode).length + 1;
      continue;
    }

    chars.push(currentCode);
    index = nextIndex;
  }

  if (value[index] !== "]") {
    return { ok: false, error: "unterminated character class" };
  }

  if (!sawContent) {
    return { ok: false, error: "empty character class" };
  }

  const matcherRanges = normalizeRanges([
    ...ranges.map((range) => ({
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    })),
    ...chars.map((code) => ({ start: code, end: code })),
  ]);

  return {
    ok: true,
    matcher: {
      ranges: matcherRanges,
      negated,
    },
    nextIndex: index,
  };
}

function createLiteralMatcher(value: string): CharMatcher {
  const code = value.codePointAt(0) ?? 0;
  return {
    ranges: [{ start: code, end: code }],
    negated: false,
  };
}

function pathPatternsOverlap(left: PathToken[], right: PathToken[]): boolean {
  const queue: Array<[number[], number[]]> = [[pathClosure(left, [0]), pathClosure(right, [0])]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [leftStates, rightStates] = queue.shift() ?? [[], []];
    const key = `${leftStates.join(",")}|${rightStates.join(",")}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    if (leftStates.includes(left.length) && rightStates.includes(right.length)) {
      return true;
    }

    const leftTransitions = collectPathTransitions(left, leftStates);
    const rightTransitions = collectPathTransitions(right, rightStates);

    for (const leftTransition of leftTransitions) {
      for (const rightTransition of rightTransitions) {
        if (!segmentMatchersOverlap(leftTransition.matcher, rightTransition.matcher)) {
          continue;
        }

        queue.push([
          pathClosure(left, [leftTransition.nextState]),
          pathClosure(right, [rightTransition.nextState]),
        ]);
      }
    }
  }

  return false;
}

function pathClosure(tokens: PathToken[], initialStates: number[]): number[] {
  const closure = new Set<number>(initialStates);
  const stack = [...initialStates];

  while (stack.length > 0) {
    const state = stack.pop() ?? 0;
    if (state >= tokens.length) {
      continue;
    }

    if (tokens[state]?.kind === "globstar" && !closure.has(state + 1)) {
      closure.add(state + 1);
      stack.push(state + 1);
    }
  }

  return [...closure].sort((left, right) => left - right);
}

function collectPathTransitions(tokens: PathToken[], states: number[]): Array<{ matcher: SegmentPattern | "any"; nextState: number }> {
  const transitions: Array<{ matcher: SegmentPattern | "any"; nextState: number }> = [];

  for (const state of states) {
    const token = tokens[state];
    if (!token) {
      continue;
    }

    if (token.kind === "globstar") {
      transitions.push({ matcher: "any", nextState: state });
      continue;
    }

    transitions.push({
      matcher: token.pattern,
      nextState: state + 1,
    });
  }

  return transitions;
}

function segmentMatchersOverlap(left: SegmentPattern | "any", right: SegmentPattern | "any"): boolean {
  if (left === "any" && right === "any") {
    return true;
  }

  if (left === "any") {
    if (right === "any") {
      return true;
    }
    return segmentPatternMatchesNonEmpty(right);
  }

  if (right === "any") {
    return segmentPatternMatchesNonEmpty(left);
  }

  return segmentPatternsOverlap(left, right);
}

function segmentPatternMatchesNonEmpty(pattern: SegmentPattern): boolean {
  return segmentPatternsOverlap(
    pattern,
    {
      raw: "*",
      tokens: [{ kind: "star" }],
    },
  );
}

function segmentPatternsOverlap(left: SegmentPattern, right: SegmentPattern): boolean {
  const queue: Array<[number[], number[], boolean]> = [[segmentClosure(left.tokens, [0]), segmentClosure(right.tokens, [0]), false]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [leftStates, rightStates, consumed] = queue.shift() ?? [[], [], false];
    const key = `${leftStates.join(",")}|${rightStates.join(",")}|${consumed ? "1" : "0"}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    if (consumed && leftStates.includes(left.tokens.length) && rightStates.includes(right.tokens.length)) {
      return true;
    }

    const leftTransitions = collectSegmentTransitions(left.tokens, leftStates);
    const rightTransitions = collectSegmentTransitions(right.tokens, rightStates);

    for (const leftTransition of leftTransitions) {
      for (const rightTransition of rightTransitions) {
        if (!charMatchersOverlap(leftTransition.matcher, rightTransition.matcher)) {
          continue;
        }

        queue.push([
          segmentClosure(left.tokens, [leftTransition.nextState]),
          segmentClosure(right.tokens, [rightTransition.nextState]),
          true,
        ]);
      }
    }
  }

  return false;
}

function segmentClosure(tokens: SegmentToken[], initialStates: number[]): number[] {
  const closure = new Set<number>(initialStates);
  const stack = [...initialStates];

  while (stack.length > 0) {
    const state = stack.pop() ?? 0;
    const token = tokens[state];
    if (!token) {
      continue;
    }

    if (token.kind === "star" && !closure.has(state + 1)) {
      closure.add(state + 1);
      stack.push(state + 1);
    }
  }

  return [...closure].sort((left, right) => left - right);
}

function collectSegmentTransitions(tokens: SegmentToken[], states: number[]): Array<{ matcher: CharMatcher; nextState: number }> {
  const transitions: Array<{ matcher: CharMatcher; nextState: number }> = [];

  for (const state of states) {
    const token = tokens[state];
    if (!token) {
      continue;
    }

    if (token.kind === "star") {
      transitions.push({
        matcher: { ranges: [...SEGMENT_ALPHABET], negated: false },
        nextState: state,
      });
      continue;
    }

    transitions.push({
      matcher: token.matcher,
      nextState: state + 1,
    });
  }

  return transitions;
}

function charMatchersOverlap(left: CharMatcher, right: CharMatcher): boolean {
  return rangesOverlap(materializeMatcherRanges(left), materializeMatcherRanges(right));
}

function materializeMatcherRanges(matcher: CharMatcher): Range[] {
  return matcher.negated ? subtractRanges(SEGMENT_ALPHABET, matcher.ranges) : intersectRanges(SEGMENT_ALPHABET, matcher.ranges);
}

function subtractRanges(source: Range[], excluded: Range[]): Range[] {
  let remaining = normalizeRanges(source);

  for (const exclusion of normalizeRanges(excluded)) {
    const next: Range[] = [];

    for (const range of remaining) {
      if (exclusion.end < range.start || exclusion.start > range.end) {
        next.push(range);
        continue;
      }

      if (exclusion.start > range.start) {
        next.push({ start: range.start, end: exclusion.start - 1 });
      }

      if (exclusion.end < range.end) {
        next.push({ start: exclusion.end + 1, end: range.end });
      }
    }

    remaining = next;
  }

  return remaining;
}

function intersectRanges(left: Range[], right: Range[]): Range[] {
  const intersections: Range[] = [];
  const normalizedLeft = normalizeRanges(left);
  const normalizedRight = normalizeRanges(right);
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < normalizedLeft.length && rightIndex < normalizedRight.length) {
    const currentLeft = normalizedLeft[leftIndex];
    const currentRight = normalizedRight[rightIndex];
    const start = Math.max(currentLeft.start, currentRight.start);
    const end = Math.min(currentLeft.end, currentRight.end);

    if (start <= end) {
      intersections.push({ start, end });
    }

    if (currentLeft.end < currentRight.end) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  return intersections;
}

function rangesOverlap(left: Range[], right: Range[]): boolean {
  return intersectRanges(left, right).length > 0;
}

function normalizeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Range[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}
