import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CliRunner } from "./cli-runner";
import { createTestEnvironment, InMemorySystemEnvironment } from "./system-environment";
import { clearConfigCache } from "./config";

function captureStreams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: unknown) => {
    stdout.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown) => {
    stderr.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;

  return {
    stdout,
    stderr,
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

describe("--json mode", () => {
  let env: InMemorySystemEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
    clearConfigCache();
  });

  afterEach(() => {
    clearConfigCache();
  });

  it("test_emits_single_json_payload_with_command_output_when_json_mode_enabled", async () => {
    env.addFile("/test/json-output.bun.md", `---
_subcommand: -e
---
console.log("json stdout");
console.error("json stderr");`);

    const runner = new CliRunner({
      env,
      cwd: "/test",
      isStdinTTY: true,
      isStdoutTTY: true,
    });

    const captured = captureStreams();
    let result;

    try {
      result = await runner.run(["node", "md", "/test/json-output.bun.md", "--json"]);
    } finally {
      captured.restore();
    }

    expect(result.exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout.length).toBeGreaterThanOrEqual(1);

    const payload = JSON.parse(captured.stdout.join(""));
    expect(payload.exitCode).toBe(0);
    expect(payload.command).toBe("bun");
    expect(Array.isArray(payload.args)).toBe(true);
    expect(payload.args).toContain("-e");
    expect(payload.stdout).toContain("json stdout");
    expect(payload.stderr).toContain("json stderr");
    expect(Object.keys(payload).sort()).toEqual(["args", "command", "exitCode", "stderr", "stdout"]);
  });

  it("does not double-encode native lifecycle command JSON", async () => {
    const runner = new CliRunner({ env, cwd: "/test" });
    const output: string[] = [];
    const prior = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    let result;

    try {
      result = await runner.run(["node", "md", "feedback", "forget", "fb_missing", "--json"]);
    } finally {
      console.log = prior;
    }

    expect(result.exitCode).toBe(1);
    expect(output).toHaveLength(1);
    const payload = JSON.parse(output[0]!);
    expect(payload).toEqual({
      error: {
        reasonCode: "CONFIRMATION_REQUIRED",
        message: "Permanent feedback deletion requires --yes.",
      },
    });
    expect(payload.stdout).toBeUndefined();
  });
});
