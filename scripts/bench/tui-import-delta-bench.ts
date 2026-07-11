#!/usr/bin/env bun

/** Measure the incremental Workbench import after md's cli-runner graph. */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function flag(name: string, fallback?: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing ${name}`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

const cwd = resolve(flag("--cwd", process.cwd()));
const scratch = resolve(flag("--scratch"));
const output = resolve(flag("--output"));
const warmups = 3;
const runs = 15;
const stateRoot = resolve(scratch, "import-probe-state");
await Promise.all([
  mkdir(resolve(stateRoot, "home"), { recursive: true }),
  mkdir(resolve(stateRoot, "tmp"), { recursive: true }),
  mkdir(dirname(output), { recursive: true }),
]);
if (await Bun.file(output).exists()) throw new Error(`Refusing to overwrite ${output}`);

const env = {
  ...process.env,
  HOME: resolve(stateRoot, "home"),
  TMPDIR: resolve(stateRoot, "tmp"),
  XDG_CONFIG_HOME: resolve(stateRoot, "xdg-config"),
  XDG_CACHE_HOME: resolve(stateRoot, "xdg-cache"),
  MDFLOW_RUNS_FILE: resolve(stateRoot, "runs.jsonl"),
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  CI: "1",
  TERM: "dumb",
};

type Phase = "cold-first-observation" | "warmup" | "measured";
interface Observation {
  phase: Phase;
  iteration: number;
  wallMs: number;
  cliRunnerImportMs: number;
  workbenchIncrementalImportMs: number;
  totalInternalMs: number;
}

async function observe(phase: Phase, iteration: number): Promise<Observation> {
  const program = [
    "const totalStart=performance.now();",
    "const cliStart=performance.now();",
    'await import("./src/cli-runner.ts");',
    "const cliRunnerImportMs=performance.now()-cliStart;",
    "const workbenchStart=performance.now();",
    'await import("./src/workbench.ts");',
    "const workbenchIncrementalImportMs=performance.now()-workbenchStart;",
    "const totalInternalMs=performance.now()-totalStart;",
    "process.stdout.write(JSON.stringify({cliRunnerImportMs,workbenchIncrementalImportMs,totalInternalMs}));",
  ].join("");
  const started = process.hrtime.bigint();
  const child = Bun.spawn([process.execPath, "-e", program], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (exitCode !== 0) throw new Error(`Child failed (${exitCode}): ${stderr}`);
  const parsed = JSON.parse(stdout) as Omit<Observation, "phase" | "iteration" | "wallMs">;
  return { phase, iteration, wallMs, ...parsed };
}

const observations: Observation[] = [];
observations.push(await observe("cold-first-observation", 0));
for (let i = 0; i < warmups; i += 1) observations.push(await observe("warmup", i + 1));
for (let i = 0; i < runs; i += 1) observations.push(await observe("measured", i + 1));
const measured = observations.filter((observation) => observation.phase === "measured");
const stats = (key: keyof Pick<Observation, "wallMs" | "cliRunnerImportMs" | "workbenchIncrementalImportMs" | "totalInternalMs">) => {
  const values = measured.map((observation) => observation[key]);
  return { minMs: Math.min(...values), medianMs: median(values) };
};

await Bun.write(output, `${JSON.stringify({
  metadata: {
    generatedAt: new Date().toISOString(),
    cwd,
    bunVersion: Bun.version,
    warmups,
    runs,
    definition: "Fresh Bun child; import cli-runner first, then time incremental workbench import in the same module registry.",
  },
  cold: observations[0],
  summary: {
    wall: stats("wallMs"),
    cliRunnerImport: stats("cliRunnerImportMs"),
    workbenchIncrementalImport: stats("workbenchIncrementalImportMs"),
    totalInternal: stats("totalInternalMs"),
  },
  observations,
}, null, 2)}\n`);
process.stdout.write(`Wrote ${output}\n`);
