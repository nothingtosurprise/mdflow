/**
 * Tests for `md explain <flow> --json` (Flow UX Protocol v1).
 *
 * The contract is FREE: it must never invoke an engine. A spy engine on PATH
 * records any invocation into a marker file so the "zero engine calls"
 * guarantee is proven, not assumed.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { chmod, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { spawnMd, createTempDir } from "./test-utils";

describe("md explain --json", () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let projectDir: string;
  let homeDir: string;
  let binDir: string;
  let spyLog: string;
  let flowPath: string;
  let longBody: string;

  const env = () => ({
    HOME: homeDir,
    MDFLOW_ENGINE: "",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    SPY_LOG: spyLog,
  });

  const explainJson = async (args: string[]) => {
    const result = await spawnMd(["explain", ...args, "--json"], {
      cwd: projectDir,
      env: env(),
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout);
  };

  beforeAll(async () => {
    ({ tempDir, cleanup } = await createTempDir("explain-json-test-"));
    projectDir = join(tempDir, "project");
    homeDir = join(tempDir, "home");
    binDir = join(tempDir, "bin");
    spyLog = join(tempDir, "engine-was-called.log");

    await mkdir(join(projectDir, "flows"), { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });

    // Spy engine: any invocation leaves a marker file.
    const spyEnginePath = join(binDir, "spyeng");
    await writeFile(spyEnginePath, `#!/bin/sh\necho invoked >> "$SPY_LOG"\necho done\n`);
    await chmod(spyEnginePath, 0o755);

    // Body longer than explain's 1000-char prose preview to prove the JSON
    // prompt is the FULL resolved prompt, never truncated.
    longBody = `Say {{ _target }}. ${"x".repeat(1500)}`;
    flowPath = join(projectDir, "flows", "task.spyeng.md");
    await writeFile(
      flowPath,
      `---
_inputs:
  _target:
    type: text
    description: What to say
    default: hello
---
${longBody}`
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  it("serializes the resolved explanation in the protocol shape", async () => {
    const payload = await explainJson([flowPath]);

    expect(payload.protocolVersion).toBe(1);
    expect(payload.flowId).toBe("project:task.spyeng");
    expect(payload.path).toBe(flowPath);
    expect(payload.engine).toBe("spyeng");
    expect(payload.command).toBe("spyeng");
    expect(typeof payload.cwd).toBe("string");
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.inputs).toEqual([
      { name: "_target", type: "text", message: "What to say", default: "hello" },
    ]);

    // Fully resolved prompt: input default applied, full length (untruncated).
    expect(payload.prompt).toContain("Say hello.");
    expect(payload.prompt).not.toContain("(truncated)");
    expect(payload.prompt.length).toBeGreaterThan(1000);
    expect(payload.promptTokensEstimate).toBe(Math.ceil(payload.prompt.length / 4));

    // Full argv: the prompt rides as the final positional.
    expect(Array.isArray(payload.args)).toBe(true);
    expect(payload.args[payload.args.length - 1]).toBe(payload.prompt);
  });

  it("applies --_name CLI overrides to the resolved prompt", async () => {
    const payload = await explainJson([flowPath, "--_target", "goodbye"]);
    expect(payload.prompt).toContain("Say goodbye.");
  });

  it("produces a stable configFingerprint that changes when the flow changes", async () => {
    const first = await explainJson([flowPath]);
    const second = await explainJson([flowPath]);

    expect(first.configFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second.configFingerprint).toBe(first.configFingerprint);

    const otherFlow = join(projectDir, "flows", "other.spyeng.md");
    await writeFile(otherFlow, "different content");
    const other = await explainJson([otherFlow]);
    expect(other.configFingerprint).not.toBe(first.configFingerprint);
  });

  it("never invokes the engine (FREE contract)", async () => {
    await explainJson([flowPath]);
    await explainJson([flowPath, "--_target", "check"]);
    expect(existsSync(spyLog)).toBe(false);
  });
});
