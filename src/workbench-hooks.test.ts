import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFile } from "./cli";
import {
  clearWorkbenchHooksStatusCache,
  getWorkbenchHooksStatus,
  hydrateWorkbenchHooksStatus,
} from "./workbench-hooks";

let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mdflow-workbench-hooks-"));
  clearWorkbenchHooksStatusCache();
});

afterEach(() => {
  clearWorkbenchHooksStatusCache();
  rmSync(directory, { recursive: true, force: true });
});

function flow(): AgentFile {
  const path = join(directory, "review.codex.md");
  writeFileSync(path, "# Review\n");
  return { name: "review.codex.md", path, source: "flows" };
}

describe("Workbench hooks hydration", () => {
  test("absent hooks stay synchronous and never invoke the event lister", async () => {
    const file = flow();
    let calls = 0;
    const listEvents = async () => {
      calls += 1;
      return { ok: true as const, events: ["stop" as const] };
    };

    expect(getWorkbenchHooksStatus(file)).toEqual({ state: "none" });
    expect(await hydrateWorkbenchHooksStatus(file, { listEvents })).toEqual({ state: "none" });
    expect(calls).toBe(0);
  });

  test("caches successful event lists by hooks path and mtime", async () => {
    const file = flow();
    const hooksPath = join(directory, "review.codex.hooks.ts");
    writeFileSync(hooksPath, "// test hook\n");
    let calls = 0;
    const listEvents = async () => {
      calls += 1;
      return { ok: true as const, events: ["sessionStart" as const, "stop" as const] };
    };

    expect(getWorkbenchHooksStatus(file)).toMatchObject({ state: "loading", path: hooksPath });
    expect(await hydrateWorkbenchHooksStatus(file, { listEvents })).toMatchObject({
      state: "ready",
      events: ["sessionStart", "stop"],
    });
    expect(await hydrateWorkbenchHooksStatus(file, { listEvents })).toMatchObject({ state: "ready" });
    expect(calls).toBe(1);

    const future = new Date(Date.now() + 2_000);
    utimesSync(hooksPath, future, future);
    expect(getWorkbenchHooksStatus(file)).toMatchObject({ state: "loading", path: hooksPath });
    await hydrateWorkbenchHooksStatus(file, { listEvents });
    expect(calls).toBe(2);
  });

  test("caches an unreadable event-list result without hiding the hooks file", async () => {
    const file = flow();
    const hooksPath = join(directory, "review.codex.hooks.ts");
    writeFileSync(hooksPath, "// broken hook\n");
    let calls = 0;
    const listEvents = async () => {
      calls += 1;
      return { ok: false as const, error: "event contract failed" };
    };

    expect(await hydrateWorkbenchHooksStatus(file, { listEvents })).toMatchObject({
      state: "error",
      path: hooksPath,
      error: "event contract failed",
    });
    expect(await hydrateWorkbenchHooksStatus(file, { listEvents })).toMatchObject({ state: "error" });
    expect(calls).toBe(1);
  });
});

describe("Workbench hooks consent + frontmatter (fusion-max #5, #6)", () => {
  test("hydration uses the static lister — a booby-trapped hooks file never executes", async () => {
    const path = join(directory, "review.codex.md");
    writeFileSync(path, "# Review\n");
    const sentinel = join(directory, "executed.txt");
    // A valid template shape (so static parse finds events) whose top-level
    // code WOULD write a sentinel if the file were ever executed.
    writeFileSync(
      join(directory, "review.codex.hooks.ts"),
      `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(sentinel)}, "x");\n` +
        "type HookHandler = (p: unknown) => unknown;\n" +
        "const handlers: Record<string, HookHandler> = {\n  stop: async (_p) => {\n  },\n};\n",
      { mode: 0o755 }
    );
    const file: AgentFile = { name: "review.codex.md", path, source: "flows" };
    const initial = getWorkbenchHooksStatus(file);
    expect(initial.state).toBe("loading");
    const hydrated = await hydrateWorkbenchHooksStatus(file);
    expect(hydrated).toMatchObject({ state: "ready", events: ["stop"] });
    expect(require("node:fs").existsSync(sentinel)).toBe(false);
  });

  test("reports _hooks: false as disabled, not as a hook file", () => {
    const path = join(directory, "review.codex.md");
    writeFileSync(path, "---\n_hooks: false\n---\n# Review\n");
    writeFileSync(
      join(directory, "review.codex.hooks.ts"),
      "const handlers: Record<string, unknown> = {\n  stop: async () => {\n  },\n};\n"
    );
    const file: AgentFile = { name: "review.codex.md", path, source: "flows" };
    expect(getWorkbenchHooksStatus(file)).toEqual({ state: "disabled" });
  });
});
