#!/usr/bin/env bun

/**
 * Isolated module-import benchmark for mdflow startup diagnosis.
 *
 * Each observation starts a fresh Bun process. The parent records wall-clock
 * process latency; the child records performance.now() around dynamic import.
 * HOME/XDG/TMPDIR point at the supplied scratch directory so top-level module
 * initialization cannot mutate the user's normal mdflow state.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface Probe {
  name: string;
  specifier: string;
  additionalSpecifiers?: string[];
  group: "floor" | "source" | "package" | "cluster";
  note?: string;
}

interface Observation {
  phase: "cold-first-observation" | "warmup" | "measured";
  iteration: number;
  wallMs: number;
  importMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

const probes: Probe[] = [
  {
    name: "dynamic-import-floor",
    specifier: "data:text/javascript,export default 1",
    group: "floor",
    note: "Fresh Bun process plus a trivial dynamic import.",
  },
  { name: "src/cli-runner.ts", specifier: "./src/cli-runner.ts", group: "source" },
  { name: "src/cli.ts", specifier: "./src/cli.ts", group: "source" },
  { name: "src/workbench.ts", specifier: "./src/workbench.ts", group: "source" },
  { name: "src/imports.ts", specifier: "./src/imports.ts", group: "source" },
  { name: "src/template.ts", specifier: "./src/template.ts", group: "source" },
  { name: "src/logger.ts", specifier: "./src/logger.ts", group: "source" },
  { name: "src/registry.ts", specifier: "./src/registry.ts", group: "source" },
  {
    name: "src/tokenizer.ts",
    specifier: "./src/tokenizer.ts",
    group: "cluster",
    note: "gpt-tokenizer path imported eagerly by cli-runner and imports.",
  },
  { name: "src/command.ts", specifier: "./src/command.ts", group: "cluster" },
  { name: "src/config.ts", specifier: "./src/config.ts", group: "cluster", note: "js-yaml config path." },
  { name: "src/workflow.ts", specifier: "./src/workflow.ts", group: "cluster" },
  {
    name: "src/context-dashboard.ts",
    specifier: "./src/context-dashboard.ts",
    group: "cluster",
    note: "Context analysis and markdown rendering path imported eagerly by cli-runner.",
  },
  {
    name: "src/imports-parser.ts",
    specifier: "./src/imports-parser.ts",
    group: "cluster",
    note: "unified + remark-parse + unist-util-visit parser cluster.",
  },
  {
    name: "package cluster: imports parser",
    specifier: "unified",
    additionalSpecifiers: ["remark-parse", "unist-util-visit"],
    group: "cluster",
    note: "Direct concurrent import of unified + remark-parse + unist-util-visit.",
  },
  {
    name: "src/markdown-renderer.ts",
    specifier: "./src/markdown-renderer.ts",
    group: "cluster",
    note: "marked + marked-terminal renderer cluster.",
  },
  {
    name: "package cluster: markdown renderer",
    specifier: "marked",
    additionalSpecifiers: ["marked-terminal"],
    group: "cluster",
    note: "Direct concurrent import of marked + marked-terminal.",
  },
  {
    name: "package cluster: TUI base",
    specifier: "@inquirer/core",
    additionalSpecifiers: ["js-yaml"],
    group: "cluster",
    note: "Primary third-party dependencies reached by workbench + workbench-model.",
  },
  { name: "src/parse.ts", specifier: "./src/parse.ts", group: "cluster", note: "js-yaml parse path." },
  { name: "src/schema.ts", specifier: "./src/schema.ts", group: "cluster", note: "zod schema path." },
  {
    name: "src/workbench-model.ts",
    specifier: "./src/workbench-model.ts",
    group: "cluster",
    note: "Workbench model plus js-yaml.",
  },
  {
    name: "src/trust.ts",
    specifier: "./src/trust.ts",
    group: "cluster",
    note: "Eager @inquirer/prompts path currently imported by cli-runner.",
  },
  { name: "pino", specifier: "pino", group: "package" },
  { name: "gpt-tokenizer", specifier: "gpt-tokenizer", group: "package" },
  { name: "@inquirer/core", specifier: "@inquirer/core", group: "package" },
  { name: "@inquirer/prompts", specifier: "@inquirer/prompts", group: "package" },
  { name: "liquidjs", specifier: "liquidjs", group: "package" },
  { name: "zod", specifier: "zod", group: "package" },
  { name: "js-yaml", specifier: "js-yaml", group: "package" },
  { name: "marked", specifier: "marked", group: "package" },
  { name: "marked-terminal", specifier: "marked-terminal", group: "package" },
  { name: "unified", specifier: "unified", group: "package" },
  { name: "remark-parse", specifier: "remark-parse", group: "package" },
  { name: "unist-util-visit", specifier: "unist-util-visit", group: "package" },
];

function flag(name: string, fallback?: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing ${name}`);
}

function positiveIntegerFlag(name: string, fallback: number): number {
  const value = Number(flag(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function percentile50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

async function observe(
  cwd: string,
  env: Record<string, string | undefined>,
  probe: Probe,
  phase: Observation["phase"],
  iteration: number,
): Promise<Observation> {
  const specifiers = [probe.specifier, ...(probe.additionalSpecifiers ?? [])];
  const childProgram = [
    "const started = performance.now();",
    `await Promise.all(${JSON.stringify(specifiers)}.map((specifier) => import(specifier)));`,
    "const importMs = performance.now() - started;",
    "process.stdout.write(JSON.stringify({ importMs }));",
  ].join("");

  const started = process.hrtime.bigint();
  const child = Bun.spawn([process.execPath, "-e", childProgram], {
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

  let importMs = Number.NaN;
  try {
    importMs = Number((JSON.parse(stdout) as { importMs: number }).importMs);
  } catch {
    // Preserve stdout/stderr in the result; the non-finite value fails below.
  }
  if (exitCode !== 0 || !Number.isFinite(importMs)) {
    throw new Error(
      `${probe.name} ${phase} ${iteration} failed (exit ${exitCode})\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }

  return { phase, iteration, wallMs, importMs, exitCode, stdout, stderr };
}

const cwd = resolve(flag("--cwd", process.cwd()));
const scratch = resolve(flag("--scratch"));
const warmups = positiveIntegerFlag("--warmups", 3);
const runs = positiveIntegerFlag("--runs", 15);
if (warmups < 3) throw new Error("Use at least 3 warmups for this benchmark");
if (runs < 10) throw new Error("Use at least 10 measured runs for this benchmark");

const isolatedRoot = resolve(scratch, "import-probe-state");
const isolatedHome = resolve(isolatedRoot, "home");
const isolatedTmp = resolve(isolatedRoot, "tmp");
const isolatedXdgConfig = resolve(isolatedRoot, "xdg-config");
const isolatedXdgCache = resolve(isolatedRoot, "xdg-cache");
await Promise.all([
  mkdir(isolatedHome, { recursive: true }),
  mkdir(isolatedTmp, { recursive: true }),
  mkdir(isolatedXdgConfig, { recursive: true }),
  mkdir(isolatedXdgCache, { recursive: true }),
]);

const env: Record<string, string | undefined> = {
  ...process.env,
  HOME: isolatedHome,
  TMPDIR: isolatedTmp,
  XDG_CONFIG_HOME: isolatedXdgConfig,
  XDG_CACHE_HOME: isolatedXdgCache,
  MDFLOW_RUNS_FILE: resolve(isolatedRoot, "runs.jsonl"),
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  CI: "1",
  TERM: "dumb",
};

const observationsByName = new Map<string, Observation[]>(
  probes.map((probe) => [probe.name, []]),
);

// Run phases round-robin so one target does not receive all of its samples at
// a systematically cooler or busier point in the suite.
for (const probe of probes) {
  observationsByName.get(probe.name)?.push(
    await observe(cwd, env, probe, "cold-first-observation", 0),
  );
}
for (let i = 0; i < warmups; i += 1) {
  for (const probe of probes) {
    observationsByName.get(probe.name)?.push(
      await observe(cwd, env, probe, "warmup", i + 1),
    );
  }
}
for (let i = 0; i < runs; i += 1) {
  for (const probe of probes) {
    observationsByName.get(probe.name)?.push(
      await observe(cwd, env, probe, "measured", i + 1),
    );
  }
}

const results = probes.map((probe) => {
  const observations = observationsByName.get(probe.name) ?? [];

  const measured = observations.filter((observation) => observation.phase === "measured");
  const wallValues = measured.map((observation) => observation.wallMs);
  const importValues = measured.map((observation) => observation.importMs);
  return {
    ...probe,
    command: `bun -e ${JSON.stringify(`const s=performance.now();await Promise.all(${JSON.stringify([probe.specifier, ...(probe.additionalSpecifiers ?? [])])}.map((specifier)=>import(specifier)));/* report performance.now()-s */`)}`,
    observations,
    summary: {
      coldWallMs: observations[0]?.wallMs,
      coldImportMs: observations[0]?.importMs,
      wallMinMs: Math.min(...wallValues),
      wallMedianMs: percentile50(wallValues),
      importMinMs: Math.min(...importValues),
      importMedianMs: percentile50(importValues),
    },
  };
});

const payload = {
  metadata: {
    generatedAt: new Date().toISOString(),
    cwd,
    bunExecutable: process.execPath,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
    warmups,
    runs,
    isolation: {
      HOME: isolatedHome,
      TMPDIR: isolatedTmp,
      XDG_CONFIG_HOME: isolatedXdgConfig,
      XDG_CACHE_HOME: isolatedXdgCache,
      MDFLOW_RUNS_FILE: env.MDFLOW_RUNS_FILE,
    },
    coldDefinition:
      "The first observed fresh Bun child for each probe, without an OS page-cache purge; compare warm min/median for ranking.",
    warmDefinition:
      "Fresh Bun child per observation after 3 process warmups; filesystem/JIT caches may be warm, but the module registry is new each process.",
    schedule:
      "Round-robin by phase (all cold observations, 3 warmup rounds, then measured rounds) to reduce target-order thermal/load bias.",
  },
  results,
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const outputIndex = Bun.argv.indexOf("--output");
const outputValue = outputIndex >= 0 ? Bun.argv[outputIndex + 1] : undefined;
if (outputValue) {
  const outputPath = resolve(outputValue);
  if (await Bun.file(outputPath).exists()) {
    throw new Error(`Refusing to overwrite benchmark output: ${outputPath}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, serialized);
  process.stdout.write(`Wrote ${outputPath}\n`);
} else {
  process.stdout.write(serialized);
}
