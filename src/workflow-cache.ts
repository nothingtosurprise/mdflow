import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";

export const WORKFLOW_CACHE_DIR = join(".mdflow", ".cache");

export interface WorkflowCacheInput {
  prompt: string;
  args: string[];
  tool: string;
  cacheDir?: string;
}

export interface WorkflowCachedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface WorkflowCacheRecord {
  key: string;
  prompt: string;
  args: string[];
  tool: string;
  result: WorkflowCachedResult;
  createdAt: string;
}

export interface WorkflowCacheLookupResult {
  hit: boolean;
  key: string;
  result?: WorkflowCachedResult;
}

function resolveCacheDir(cacheDir: string = WORKFLOW_CACHE_DIR): string {
  if (isAbsolute(cacheDir)) return cacheDir;
  return resolve(process.cwd(), cacheDir);
}

function resolveCacheFilePath(cacheDir: string, key: string): string {
  return join(resolveCacheDir(cacheDir), `${key}.json`);
}

export function createWorkflowCacheKey(input: Omit<WorkflowCacheInput, "cacheDir">): string {
  const payload = JSON.stringify({
    prompt: input.prompt,
    args: input.args,
    tool: input.tool,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export async function getCachedResult(input: WorkflowCacheInput): Promise<WorkflowCacheLookupResult> {
  const key = createWorkflowCacheKey(input);
  const cacheDir = input.cacheDir ?? WORKFLOW_CACHE_DIR;
  const cachePath = resolveCacheFilePath(cacheDir, key);

  let raw: string;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch {
    return { hit: false, key };
  }

  try {
    const parsed = JSON.parse(raw) as WorkflowCacheRecord;
    if (parsed.result.exitCode !== 0) {
      return { hit: false, key };
    }

    return {
      hit: true,
      key,
      result: parsed.result,
    };
  } catch {
    return { hit: false, key };
  }
}

export async function setCachedResult(
  input: WorkflowCacheInput,
  result: WorkflowCachedResult
): Promise<{ key: string }> {
  const key = createWorkflowCacheKey(input);
  const cacheDir = input.cacheDir ?? WORKFLOW_CACHE_DIR;
  const cachePath = resolveCacheFilePath(cacheDir, key);

  await mkdir(dirname(cachePath), { recursive: true });

  const record: WorkflowCacheRecord = {
    key,
    prompt: input.prompt,
    args: input.args,
    tool: input.tool,
    result,
    createdAt: new Date().toISOString(),
  };

  await writeFile(cachePath, JSON.stringify(record, null, 2), "utf8");
  return { key };
}
