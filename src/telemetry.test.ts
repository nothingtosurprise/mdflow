import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getRecentRuns, recordRun, type RunRecord } from "./telemetry";

const RUNS_FILE_ENV = "MDFLOW_RUNS_FILE";

describe("telemetry", () => {
  let tempDir: string;
  let runsPath: string;
  let originalRunsFile: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mdflow-telemetry-test-"));
    runsPath = join(tempDir, "runs.jsonl");
    originalRunsFile = process.env[RUNS_FILE_ENV];
    process.env[RUNS_FILE_ENV] = runsPath;
  });

  afterEach(async () => {
    if (originalRunsFile === undefined) {
      delete process.env[RUNS_FILE_ENV];
    } else {
      process.env[RUNS_FILE_ENV] = originalRunsFile;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("test_recordRun_appends_jsonl_entries_and_getRecentRuns_reads_them", async () => {
    const first: RunRecord = {
      agentPath: "/tmp/first.md",
      tool: "claude",
      durationMs: 250,
      exitCode: 0,
      outputBytes: 1024,
      timestamp: "2026-02-10T10:00:00.000Z",
    };
    const second: RunRecord = {
      agentPath: "/tmp/second.md",
      tool: "gemini",
      durationMs: 800,
      exitCode: 1,
      outputBytes: 64,
      timestamp: "2026-02-10T10:01:00.000Z",
    };

    await recordRun(first);
    await recordRun(second);

    const runs = await getRecentRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(first);
    expect(runs[1]).toEqual(second);
  });

  test("test_getRecentRuns_returns_last_20_by_default", async () => {
    for (let i = 0; i < 25; i++) {
      await recordRun({
        agentPath: `/tmp/agent-${i}.md`,
        tool: "claude",
        durationMs: i * 10,
        exitCode: 0,
        outputBytes: i,
        timestamp: `2026-02-10T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const runs = await getRecentRuns();
    expect(runs).toHaveLength(20);
    expect(runs[0]?.agentPath).toBe("/tmp/agent-5.md");
    expect(runs[19]?.agentPath).toBe("/tmp/agent-24.md");
  });

  test("test_getRecentRuns_returns_last_n_entries_when_limit_is_set", async () => {
    for (let i = 0; i < 4; i++) {
      await recordRun({
        agentPath: `/tmp/agent-${i}.md`,
        tool: "claude",
        durationMs: i * 10,
        exitCode: 0,
        outputBytes: i,
        timestamp: `2026-02-10T10:0${i}:00.000Z`,
      });
    }

    const runs = await getRecentRuns(2);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.agentPath)).toEqual(["/tmp/agent-2.md", "/tmp/agent-3.md"]);
  });

  test("test_getRecentRuns_skips_malformed_json_lines", async () => {
    const valid: RunRecord = {
      agentPath: "/tmp/valid.md",
      tool: "claude",
      durationMs: 55,
      exitCode: 0,
      outputBytes: 11,
      timestamp: "2026-02-10T10:00:00.000Z",
    };

    await Bun.write(
      runsPath,
      `${JSON.stringify(valid)}\nnot json\n${JSON.stringify({ ...valid, agentPath: "/tmp/valid-2.md" })}\n`
    );

    const runs = await getRecentRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.agentPath).toBe("/tmp/valid.md");
    expect(runs[1]?.agentPath).toBe("/tmp/valid-2.md");
  });
});
