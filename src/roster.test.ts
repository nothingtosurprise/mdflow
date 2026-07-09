/**
 * Tests for `md roster --json` (Flow UX Protocol v1).
 *
 * Uses spawned CLI processes with HOME redirected into a temp directory so
 * project, global, and registry sources are all fully controlled. Engines are
 * pinned to `echo` (a real binary) so filename/frontmatter resolution behaves
 * exactly like production without ever invoking an LLM.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { spawnMd, createTempDir } from "./test-utils";
import { mapInputsToProtocol, classifyFlowPath } from "./roster";

describe("md roster --json", () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let projectDir: string;
  let homeDir: string;

  const runRoster = async (cwd: string) => {
    const result = await spawnMd(["roster", "--json"], {
      cwd,
      env: { HOME: homeDir, MDFLOW_ENGINE: "" },
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout);
  };

  beforeAll(async () => {
    ({ tempDir, cleanup } = await createTempDir("roster-test-"));
    projectDir = join(tempDir, "project");
    homeDir = join(tempDir, "home");

    await mkdir(join(projectDir, "flows"), { recursive: true });
    await mkdir(join(projectDir, ".mdflow", "registry"), { recursive: true });
    await mkdir(join(homeDir, ".mdflow", "registry"), { recursive: true });

    // Project flows (one of each interesting shape).
    await writeFile(
      join(projectDir, "flows", "review.md"),
      `---
description: Review changes
engine: echo
_inputs:
  _target:
    type: select
    description: Pick one
    options: [a, b]
    default: a
  _name:
    type: text
---
Review {{ _target }}`
    );
    await writeFile(
      join(projectDir, "flows", "wf.md"),
      `---
engine: echo
_steps:
  - id: a
    run: one
  - id: b
    run: two
    needs: [a]
---
`
    );
    // Interactive via the .i. filename marker; engine via filename (echo).
    await writeFile(join(projectDir, "flows", "chat.i.echo.md"), "talk");
    // Document: no frontmatter, no engine marker — must be excluded.
    await writeFile(join(projectDir, "flows", "notes.md"), "just a document");
    // Roster README is never executable.
    await writeFile(join(projectDir, "flows", "README.md"), "roster index");

    // Global flow.
    await writeFile(join(homeDir, ".mdflow", "personal.md"), `---
engine: echo
---
hi`);

    // Registry flow (project scope).
    await writeFile(
      join(projectDir, ".mdflow", "registry", "installed.md"),
      `---
engine: echo
description: from registry
---
go`
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  it("emits the protocol shape with stable ids in project, global, registry order", async () => {
    const roster = await runRoster(projectDir);

    expect(roster.protocolVersion).toBe(1);
    expect(typeof roster.cwd).toBe("string");
    expect(typeof roster.projectRoot).toBe("string");
    expect(Array.isArray(roster.warnings)).toBe(true);

    const ids = roster.flows.map((flow: { id: string }) => flow.id);
    expect(ids).toEqual([
      "project:chat.i.echo",
      "project:review",
      "project:wf",
      "global:personal",
      "registry:installed",
    ]);
  });

  it("excludes documents (no frontmatter, no engine marker) and README.md", async () => {
    const roster = await runRoster(projectDir);
    const ids = roster.flows.map((flow: { id: string }) => flow.id);
    expect(ids).not.toContain("project:notes");
    expect(ids).not.toContain("project:README");
  });

  it("resolves engine and engineSource per the normal ladder", async () => {
    const roster = await runRoster(projectDir);
    const byId = Object.fromEntries(roster.flows.map((flow: { id: string }) => [flow.id, flow]));

    expect(byId["project:review"].engine).toBe("echo");
    expect(byId["project:review"].engineSource).toBe("frontmatter");
    expect(byId["project:chat.i.echo"].engine).toBe("echo");
    expect(byId["project:chat.i.echo"].engineSource).toBe("filename");
  });

  it("maps _inputs, _steps, interactive markers, description, and mtimeMs", async () => {
    const roster = await runRoster(projectDir);
    const byId = Object.fromEntries(roster.flows.map((flow: { id: string }) => [flow.id, flow]));

    const review = byId["project:review"];
    expect(review.description).toBe("Review changes");
    expect(review.isWorkflow).toBe(false);
    expect(review.interactive).toBe(false);
    expect(typeof review.mtimeMs).toBe("number");
    expect(Number.isInteger(review.mtimeMs)).toBe(true);
    expect(review.inputs).toEqual([
      { name: "_target", type: "select", message: "Pick one", default: "a", options: ["a", "b"] },
      { name: "_name", type: "text", message: null, default: null },
    ]);

    expect(byId["project:wf"].isWorkflow).toBe(true);
    expect(byId["project:wf"].description).toBeNull();
    expect(byId["project:chat.i.echo"].interactive).toBe(true);
    expect(byId["global:personal"].source).toBe("global");
    expect(byId["registry:installed"].source).toBe("registry");
    expect(byId["registry:installed"].description).toBe("from registry");
  });

  it("exits 0 with empty flows and a warnings array when nothing exists", async () => {
    const emptyDir = join(tempDir, "empty");
    const emptyHome = join(tempDir, "empty-home");
    await mkdir(emptyDir, { recursive: true });
    await mkdir(emptyHome, { recursive: true });

    const result = await spawnMd(["roster", "--json"], {
      cwd: emptyDir,
      env: { HOME: emptyHome, MDFLOW_ENGINE: "" },
    });

    expect(result.exitCode).toBe(0);
    const roster = JSON.parse(result.stdout);
    expect(roster.protocolVersion).toBe(1);
    expect(roster.flows).toEqual([]);
    expect(Array.isArray(roster.warnings)).toBe(true);
  });
});

describe("roster helpers", () => {
  it("maps legacy string[] _inputs to text inputs", () => {
    expect(mapInputsToProtocol(["_a", "_b"])).toEqual([
      { name: "_a", type: "text", message: null, default: null },
      { name: "_b", type: "text", message: null, default: null },
    ]);
  });

  it("returns [] for missing or malformed _inputs", () => {
    expect(mapInputsToProtocol(undefined)).toEqual([]);
    expect(mapInputsToProtocol("nope")).toEqual([]);
  });

  it("classifies paths into project, global, and registry sources", () => {
    const home = "/home/u";
    const projectRoot = "/repo";
    expect(classifyFlowPath("/repo/flows/x.md", { projectRoot, homeDir: home })).toBe("project");
    expect(classifyFlowPath("/home/u/.mdflow/x.md", { projectRoot, homeDir: home })).toBe("global");
    expect(
      classifyFlowPath("/home/u/.mdflow/registry/x.md", { projectRoot, homeDir: home })
    ).toBe("registry");
    expect(
      classifyFlowPath("/repo/.mdflow/registry/x.md", { projectRoot, homeDir: home })
    ).toBe("registry");
  });
});
