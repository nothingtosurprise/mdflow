import type { ProviderImportAction, ProviderName } from "./imports-types";

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_GIT_LOG_COUNT = 20;
const TRUNCATED_SUFFIX = "... (truncated)";

type ContextProviderErrorCode =
  | "unknown_provider"
  | "missing_argument"
  | "spawn_failed"
  | "command_failed";

interface ContextProviderErrorDetails {
  code: ContextProviderErrorCode;
  provider: string;
  attemptedCommand?: string[];
  exitCode?: number;
  stderr?: string;
}

export class ContextProviderError extends Error {
  readonly details: ContextProviderErrorDetails;

  constructor(message: string, details: ContextProviderErrorDetails) {
    super(message);
    this.name = "ContextProviderError";
    this.details = details;
  }
}

interface ProviderDefinition {
  buildCommand: (arg?: string) => string[];
  allowExitCodes?: readonly number[];
  onTruncatedCommand?: (arg?: string) => string[];
}

export interface ContextProviderOptions {
  cwd: string;
  maxTokens?: number;
}

function parseGitLogCount(arg?: string): number {
  if (!arg) {
    return DEFAULT_GIT_LOG_COUNT;
  }

  const parsed = Number.parseInt(arg, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GIT_LOG_COUNT;
  }

  return parsed;
}

function buildRgCommand(arg?: string): string[] {
  const pattern = (arg ?? "").trim();
  if (!pattern) {
    throw new ContextProviderError('Provider "rg" requires a non-empty pattern.', {
      code: "missing_argument",
      provider: "rg",
    });
  }

  return ["rg", "--no-heading", "--", pattern, "."];
}

export const providerRegistry: Readonly<Record<ProviderName, ProviderDefinition>> = Object.freeze({
  "git:diff": {
    buildCommand: () => ["git", "diff"],
    onTruncatedCommand: () => ["git", "diff", "--stat"],
  },
  "git:staged": {
    buildCommand: () => ["git", "diff", "--staged"],
  },
  "git:status": {
    buildCommand: () => ["git", "status", "--porcelain"],
  },
  "git:log": {
    buildCommand: (arg) => ["git", "log", "--oneline", `-${parseGitLogCount(arg)}`],
  },
  tree: {
    buildCommand: () => ["find", ".", "-type", "f", "-not", "-path", "./.git/*"],
  },
  rg: {
    buildCommand: (arg) => buildRgCommand(arg),
    allowExitCodes: [0, 1],
  },
});

const providerNames = new Set<ProviderName>(Object.keys(providerRegistry) as ProviderName[]);

function isProviderName(name: string): name is ProviderName {
  return providerNames.has(name as ProviderName);
}

function normalizeMaxTokens(maxTokens?: number): number | undefined {
  if (maxTokens === undefined || maxTokens === null) {
    return undefined;
  }

  if (!Number.isFinite(maxTokens)) {
    return undefined;
  }

  return Math.max(0, Math.floor(maxTokens));
}

function truncateOutputIfNeeded(
  output: string,
  maxTokens?: number
): { output: string; truncated: boolean } {
  const normalizedMaxTokens = normalizeMaxTokens(maxTokens);
  const normalizedOutput = output.trimEnd();

  if (normalizedMaxTokens === undefined) {
    return { output: normalizedOutput, truncated: false };
  }

  const maxChars = normalizedMaxTokens * CHARS_PER_TOKEN_ESTIMATE;
  if (normalizedOutput.length <= maxChars) {
    return { output: normalizedOutput, truncated: false };
  }

  if (maxChars <= TRUNCATED_SUFFIX.length) {
    return { output: TRUNCATED_SUFFIX, truncated: true };
  }

  const visibleChars = maxChars - TRUNCATED_SUFFIX.length;
  return {
    output: `${normalizedOutput.slice(0, visibleChars)}${TRUNCATED_SUFFIX}`,
    truncated: true,
  };
}

async function runCommand(
  providerName: string,
  command: string[],
  cwd: string,
  allowExitCodes: readonly number[]
): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn(command, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextProviderError(
      `Failed to start provider "${providerName}" command: ${command.join(" ")}`,
      {
        code: "spawn_failed",
        provider: providerName,
        attemptedCommand: command,
        stderr: message,
      }
    );
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout as ReadableStream<Uint8Array>).text() : "",
    proc.stderr ? new Response(proc.stderr as ReadableStream<Uint8Array>).text() : "",
    proc.exited,
  ]);

  if (!allowExitCodes.includes(exitCode)) {
    throw new ContextProviderError(
      `Provider "${providerName}" command failed (${exitCode}): ${command.join(" ")}`,
      {
        code: "command_failed",
        provider: providerName,
        attemptedCommand: command,
        exitCode,
        stderr: stderr.trim(),
      }
    );
  }

  return stdout;
}

async function runProviderWithCwd(
  name: string,
  arg: string | undefined,
  maxTokens: number | undefined,
  cwd: string
): Promise<string> {
  if (!isProviderName(name)) {
    throw new ContextProviderError(`Unknown context provider: ${name}`, {
      code: "unknown_provider",
      provider: name,
    });
  }

  const provider = providerRegistry[name];
  const allowExitCodes = provider.allowExitCodes ?? [0];
  const primaryOutput = await runCommand(name, provider.buildCommand(arg), cwd, allowExitCodes);
  const primaryResult = truncateOutputIfNeeded(primaryOutput, maxTokens);

  if (!primaryResult.truncated) {
    return primaryResult.output;
  }

  if (name === "git:diff" && provider.onTruncatedCommand) {
    const fallbackOutput = await runCommand(
      name,
      provider.onTruncatedCommand(arg),
      cwd,
      allowExitCodes
    );
    return truncateOutputIfNeeded(fallbackOutput, maxTokens).output;
  }

  return primaryResult.output;
}

export async function runProvider(
  name: string,
  arg?: string,
  maxTokens?: number
): Promise<string> {
  return runProviderWithCwd(name, arg, maxTokens, process.cwd());
}

export async function resolveContextProviderImport(
  action: ProviderImportAction,
  options: ContextProviderOptions
): Promise<string> {
  return runProviderWithCwd(action.provider, action.argument, options.maxTokens, options.cwd);
}
