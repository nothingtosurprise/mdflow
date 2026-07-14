/**
 * Process-level isolation regressions. A fake Codex binary captures the
 * environment mdflow actually spawns, so these tests cover the full pipeline
 * rather than only adapter return values.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "index.ts");

let root: string;
let home: string;
let ambientCodexHome: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mdflow-isolation-int-"));
  home = join(root, "home");
  ambientCodexHome = join(root, "ambient-codex");
  binDir = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(ambientCodexHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(ambientCodexHome, "auth.json"), '{"token":"test"}');
  writeFileSync(
    join(ambientCodexHome, "config.toml"),
    `[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`
  );
  writeFileSync(
    join(ambientCodexHome, "hooks.json"),
    '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"ambient-hook"}]}]}}'
  );

  const codexStub = join(binDir, "codex");
  writeFileSync(
    codexStub,
    `#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
const codexHome = process.env.CODEX_HOME ?? "";
await Bun.write(process.env.MDFLOW_TEST_RECEIPT!, JSON.stringify({
  codexHome,
  hooksPresent: existsSync(join(codexHome, "hooks.json")),
  args: process.argv.slice(2),
}));
`
  );
  chmodSync(codexStub, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFlow(name: string, extraFrontmatter = ""): string {
  const flow = join(root, name);
  writeFileSync(
    flow,
    `---\ndescription: isolation regression${extraFrontmatter ? `\n${extraFrontmatter}` : ""}\n---\nSay ok.\n`
  );
  return flow;
}

async function runFlow(flow: string, receipt: string) {
  const proc = Bun.spawn(["bun", "run", CLI, flow], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: ambientCodexHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      MDFLOW_EVAL_RUN: "1",
      MDFLOW_TEST_RECEIPT: receipt,
      NO_COLOR: "1",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function readReceipt(path: string): {
  codexHome: string;
  hooksPresent: boolean;
  args: string[];
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Codex isolation environment", () => {
  it("excludes ambient hooks from hookless exec and interactive flows", async () => {
    const preparedHome = join(home, ".mdflow", "codex-hooks-home");

    for (const name of ["hookless.codex.md", "hookless.i.codex.md"]) {
      const receipt = join(root, `${name}.receipt.json`);
      const result = await runFlow(writeFlow(name), receipt);
      expect(result.exitCode).toBe(0);

      const spawned = readReceipt(receipt);
      expect(spawned.codexHome).toBe(preparedHome);
      expect(spawned.hooksPresent).toBe(false);
      expect(existsSync(join(preparedHome, "hooks.json"))).toBe(false);
    }
  });

  it("keeps isolation with _hooks false and restores ambient hooks only with _isolated false", async () => {
    const disabledHooksReceipt = join(root, "hooks-disabled.receipt.json");
    const disabledHooks = await runFlow(
      writeFlow("hooks-disabled.i.codex.md", "_hooks: false"),
      disabledHooksReceipt
    );
    expect(disabledHooks.exitCode).toBe(0);
    expect(readReceipt(disabledHooksReceipt)).toMatchObject({
      codexHome: join(home, ".mdflow", "codex-hooks-home"),
      hooksPresent: false,
    });

    const ambientReceipt = join(root, "ambient.receipt.json");
    const ambient = await runFlow(
      writeFlow("ambient.codex.md", "_isolated: false"),
      ambientReceipt
    );
    expect(ambient.exitCode).toBe(0);
    expect(readReceipt(ambientReceipt)).toMatchObject({
      codexHome: ambientCodexHome,
      hooksPresent: true,
    });
  });
});
