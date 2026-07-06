import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const RUNS_FILE_ENV = "MDFLOW_RUNS_FILE";
const DEFAULT_RUNS_PATH = join(homedir(), ".mdflow", "runs.jsonl");

export interface RunRecord {
  agentPath: string;
  tool: string;
  durationMs: number;
  exitCode: number;
  outputBytes: number;
  timestamp: string;
}

function getRunsFilePath(): string {
  const override = process.env[RUNS_FILE_ENV]?.trim();
  return override ? override : DEFAULT_RUNS_PATH;
}

function isRunRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RunRecord>;

  return typeof candidate.agentPath === "string"
    && typeof candidate.tool === "string"
    && typeof candidate.durationMs === "number"
    && typeof candidate.exitCode === "number"
    && typeof candidate.outputBytes === "number"
    && typeof candidate.timestamp === "string";
}

/**
 * Append a telemetry record to ~/.mdflow/runs.jsonl (or MDFLOW_RUNS_FILE override).
 */
export async function recordRun(data: RunRecord): Promise<void> {
  const filePath = getRunsFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(data)}\n`, "utf-8");
}

/**
 * Read and parse the most recent telemetry entries.
 */
export async function getRecentRuns(limit = 20): Promise<RunRecord[]> {
  const filePath = getRunsFilePath();

  const file = Bun.file(filePath);
  if (!await file.exists()) {
    return [];
  }

  let content = "";
  try {
    content = await file.text();
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const selectedLines = lines.slice(-normalizedLimit);

  const records: RunRecord[] = [];
  for (const line of selectedLines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRunRecord(parsed)) records.push(parsed);
    } catch {
      // Ignore malformed lines to keep telemetry reads resilient.
    }
  }

  return records;
}
