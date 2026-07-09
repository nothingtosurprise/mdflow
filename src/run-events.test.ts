/**
 * Tests for `md <flow> --events` — the NDJSON run event stream
 * (Flow UX Protocol v1).
 *
 * A fake engine executable on PATH stands in for a real LLM CLI, so the
 * contract is proven against actual spawned processes: stdout purity, seq
 * monotonicity, event ordering, workflow step boundaries, error mapping,
 * and SIGTERM cancellation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { chmod, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir, CLI_PATH } from "./test-utils";

interface RunEvent {
  protocolVersion: number;
  seq: number;
  runId: string;
  ts: number;
  event: string;
  [key: string]: unknown;
}

const TERMINAL_EVENTS = new Set(["run.completed", "run.error", "run.cancelled"]);

/** Parse NDJSON stdout; throws if any line is not a standalone JSON object. */
function parseEvents(stdout: string): RunEvent[] {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  return lines.map((line) => JSON.parse(line) as RunEvent);
}

/** Assert the common envelope contract on a full event stream. */
function assertEnvelope(events: RunEvent[]): void {
  expect(events.length).toBeGreaterThanOrEqual(2);

  // protocol first.
  expect(events[0]!.event).toBe("protocol");
  expect(typeof events[0]!.mdflowVersion).toBe("string");

  // seq starts at 0, increments by 1, no gaps; runId and version stable.
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    expect(event.protocolVersion).toBe(1);
    expect(event.seq).toBe(i);
    expect(event.runId).toBe(events[0]!.runId);
    expect(event.runId).toMatch(/^r-[0-9a-f-]{36}$/);
    expect(typeof event.ts).toBe("number");
  }

  // Exactly one terminal event, and it is last.
  const terminals = events.filter((event) => TERMINAL_EVENTS.has(event.event));
  expect(terminals).toHaveLength(1);
  expect(TERMINAL_EVENTS.has(events[events.length - 1]!.event)).toBe(true);
}

describe("md <flow> --events", () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let projectDir: string;
  let homeDir: string;
  let binDir: string;

  const runEvents = async (
    args: string[],
    extraEnv: Record<string, string> = {}
  ): Promise<{ events: RunEvent[]; stdout: string; stderr: string; exitCode: number }> => {
    const proc = spawn({
      cmd: ["bun", "run", CLI_PATH, ...args, "--events"],
      cwd: projectDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: homeDir,
        MDFLOW_ENGINE: "",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        ...extraEnv,
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { events: parseEvents(stdout), stdout, stderr, exitCode };
  };

  beforeAll(async () => {
    ({ tempDir, cleanup } = await createTempDir("run-events-test-"));
    projectDir = join(tempDir, "project");
    homeDir = join(tempDir, "home");
    binDir = join(tempDir, "bin");

    await mkdir(join(projectDir, "flows"), { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });

    // Fake engine: prints stdout + stderr, exits with FKENG_EXIT (default 0).
    const fkeng = join(binDir, "fkeng");
    await writeFile(
      fkeng,
      `#!/bin/sh\necho "ENGINE_OUT: $1"\necho "ENGINE_ERR" >&2\nexit \${FKENG_EXIT:-0}\n`
    );
    await chmod(fkeng, 0o755);

    // Slow engine for cancellation.
    const slpeng = join(binDir, "slpeng");
    await writeFile(slpeng, `#!/bin/sh\necho begun\nsleep 20\necho done\n`);
    await chmod(slpeng, 0o755);

    await writeFile(join(projectDir, "flows", "basic.fkeng.md"), "prompt text here");
    await writeFile(join(projectDir, "flows", "chat.i.fkeng.md"), "interactive prompt");
    await writeFile(join(projectDir, "flows", "slow.slpeng.md"), "slow prompt");
    await writeFile(
      join(projectDir, "flows", "wf.md"),
      `---
engine: fkeng
_steps:
  - id: a
    run: first step
  - id: b
    run: second step
    needs: [a]
---
`
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  it("keeps stdout protocol-pure: every line is JSON, engine text only inside output.delta", async () => {
    const { events, stdout, exitCode } = await runEvents(["basic.fkeng"]);

    expect(exitCode).toBe(0);
    // parseEvents already proved every line parses; also prove no raw
    // engine output leaked outside JSON events.
    for (const line of stdout.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line.startsWith("{")).toBe(true);
    }

    const deltas = events.filter((event) => event.event === "output.delta");
    const stdoutText = deltas
      .filter((event) => event.channel === "stdout")
      .map((event) => event.text)
      .join("");
    const stderrText = deltas
      .filter((event) => event.channel === "stderr")
      .map((event) => event.text)
      .join("");
    expect(stdoutText).toContain("ENGINE_OUT: prompt text here");
    expect(stderrText).toContain("ENGINE_ERR");
  });

  it("orders events: protocol, run.started, deltas, exactly one terminal run.completed", async () => {
    const { events, exitCode } = await runEvents(["basic.fkeng"]);

    expect(exitCode).toBe(0);
    assertEnvelope(events);

    expect(events[1]!.event).toBe("run.started");
    const started = events[1]!;
    expect(started.flowId).toBe("project:basic.fkeng");
    expect(String(started.path)).toEndWith("flows/basic.fkeng.md");
    expect(started.engine).toBe("fkeng");
    expect(started.command).toBe("fkeng");
    expect(Array.isArray(started.args)).toBe(true);
    expect(typeof started.pid).toBe("number");
    expect(typeof started.cwd).toBe("string");

    const terminal = events[events.length - 1]!;
    expect(terminal.event).toBe("run.completed");
    expect(terminal.exitCode).toBe(0);
    expect(typeof terminal.durationMs).toBe("number");
  });

  it("emits run.error with the engine exit code on nonzero exit", async () => {
    const { events, exitCode } = await runEvents(["basic.fkeng"], { FKENG_EXIT: "3" });

    expect(exitCode).toBe(3);
    assertEnvelope(events);
    const terminal = events[events.length - 1]!;
    expect(terminal.event).toBe("run.error");
    expect(terminal.exitCode).toBe(3);
    expect(typeof terminal.message).toBe("string");
  });

  it("rejects TTY-only interactive flows with the exact protocol message", async () => {
    const { events, exitCode } = await runEvents(["chat.i.fkeng"]);

    expect(exitCode).not.toBe(0);
    assertEnvelope(events);
    const terminal = events[events.length - 1]!;
    expect(terminal.event).toBe("run.error");
    expect(terminal.message).toBe("interactive flow requires a terminal");
    expect(events.some((event) => event.event === "run.started")).toBe(false);
  });

  it("emits step boundaries for workflow _steps in dependency order", async () => {
    const { events, exitCode } = await runEvents(["wf"]);

    expect(exitCode).toBe(0);
    assertEnvelope(events);
    expect(events[1]!.event).toBe("run.started");

    const names = events.map((event) =>
      event.event.startsWith("step.") ? `${event.event}:${event.stepId}` : event.event
    );
    const orderOf = (name: string) => names.indexOf(name);

    expect(orderOf("step.started:a")).toBeGreaterThan(orderOf("run.started"));
    expect(orderOf("step.completed:a")).toBeGreaterThan(orderOf("step.started:a"));
    expect(orderOf("step.started:b")).toBeGreaterThan(orderOf("step.completed:a"));
    expect(orderOf("step.completed:b")).toBeGreaterThan(orderOf("step.started:b"));
    expect(names[names.length - 1]).toBe("run.completed");

    const stepA = events.find((event) => event.event === "step.started" && event.stepId === "a")!;
    const stepB = events.find((event) => event.event === "step.started" && event.stepId === "b")!;
    expect(stepA.needs).toEqual([]);
    expect(stepB.needs).toEqual(["a"]);

    const completedA = events.find(
      (event) => event.event === "step.completed" && event.stepId === "a"
    )!;
    expect(completedA.exitCode).toBe(0);
    expect(completedA.cached).toBe(false);
  });

  it("forwards SIGTERM to the engine child and emits run.cancelled", async () => {
    const proc = spawn({
      cmd: ["bun", "run", CLI_PATH, "slow.slpeng", "--events"],
      cwd: projectDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: homeDir,
        MDFLOW_ENGINE: "",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    // Give the run time to emit run.started, then cancel.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
    proc.kill("SIGTERM");

    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const events = parseEvents(stdout);
    assertEnvelope(events);

    expect(events[1]!.event).toBe("run.started");
    const terminal = events[events.length - 1]!;
    expect(terminal.event).toBe("run.cancelled");
    expect(terminal.signal).toBe("SIGTERM");
    expect(typeof terminal.durationMs).toBe("number");
  }, 20_000);
});
