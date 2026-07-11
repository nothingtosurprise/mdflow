#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WARMUPS = 3;
const SAMPLES = 15;

function requiredFlag(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return resolve(value);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

async function timed<T>(fn: () => T | Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

async function bench<T>(
  name: string,
  fn: () => T | Promise<T>,
  describe: (value: T) => unknown,
) {
  const first = await timed(fn);
  const warmupsMs: number[] = [];
  for (let index = 0; index < WARMUPS; index++) {
    warmupsMs.push((await timed(fn)).ms);
  }

  const samplesMs: number[] = [];
  let lastValue = first.value;
  for (let index = 0; index < SAMPLES; index++) {
    const sample = await timed(fn);
    samplesMs.push(sample.ms);
    lastValue = sample.value;
  }

  return {
    name,
    firstMs: first.ms,
    minMs: Math.min(...samplesMs),
    medianMs: median(samplesMs),
    meanMs: samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length,
    maxMs: Math.max(...samplesMs),
    warmupsMs,
    samplesMs,
    firstResult: describe(first.value),
    lastResult: describe(lastValue),
  };
}

async function sha256(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function inventory(root: string): Promise<Array<{ path: string; kind: string; bytes: number }>> {
  if (!existsSync(root)) return [];
  const result: Array<{ path: string; kind: string; bytes: number }> = [];
  const visit = async (path: string): Promise<void> => {
    const info = await stat(path);
    result.push({
      path: path.slice(root.length).replace(/^\//, "") || ".",
      kind: info.isDirectory() ? "directory" : "file",
      bytes: info.size,
    });
    if (!info.isDirectory()) return;
    for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
  };
  await visit(root);
  return result;
}

/** Conservative fast-negative gate. False means the Markdown AST parser is unnecessary. */
function hasImportCandidate(content: string): boolean {
  return content.includes("@") || content.includes("!`") || content.includes("#!");
}

const snapshot = requiredFlag("--snapshot");
const scratch = requiredFlag("--scratch");
const fixture = requiredFlag("--fixture");
const isolatedHome = requiredFlag("--home");
const indexPath = join(snapshot, "src", "index.ts");
const runnerPath = join(snapshot, "src", "cli-runner.ts");

for (const path of [indexPath, runnerPath, fixture]) {
  if (!await Bun.file(path).exists()) throw new Error(`Required input does not exist: ${path}`);
}

// Bun caches os.homedir() at process startup. The caller must set HOME before
// launching Bun and pass the same path here; changing HOME only in-process is
// too late to isolate modules that call homedir().
const homeWithinScratch = relative(scratch, isolatedHome);
if (
  homeWithinScratch.startsWith("..")
  || resolve(process.env.HOME ?? "") !== isolatedHome
  || resolve(homedir()) !== isolatedHome
) {
  throw new Error(
    `Isolated HOME must be nested under --scratch and exported before Bun starts: ${isolatedHome}`,
  );
}
const xdgRoot = join(isolatedHome, ".xdg");
await mkdir(isolatedHome, { recursive: true });
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
process.env.XDG_CONFIG_HOME = join(xdgRoot, "config");
process.env.XDG_CACHE_HOME = join(xdgRoot, "cache");
process.env.XDG_DATA_HOME = join(xdgRoot, "data");
process.env.XDG_STATE_HOME = join(xdgRoot, "state");
process.env.MDFLOW_RUNS_FILE = join(isolatedHome, ".mdflow", "runs.jsonl");
process.chdir(snapshot);

const moduleUrl = (relativePath: string) => pathToFileURL(join(snapshot, relativePath)).href;

// Import costs are deliberately excluded; a separate benchmark owns module graph timing.
const config: any = await import(moduleUrl("src/config.ts"));
const parse: any = await import(moduleUrl("src/parse.ts"));
const importParser: any = await import(moduleUrl("src/imports-parser.ts"));
const imports: any = await import(moduleUrl("src/imports.ts"));
const cli: any = await import(moduleUrl("src/cli.ts"));
const workbenchStatus: any = await import(moduleUrl("src/workbench-status.ts"));
const compat: any = await import(moduleUrl("src/compat.ts"));

const fixtureContent = await Bun.file(fixture).text();
const parsedFixture = parse.parseFrontmatter(fixtureContent);
const fixtureBody = parsedFixture.body as string;
const results: unknown[] = [];

results.push(await bench(
  "loadGlobalConfig",
  () => config.loadGlobalConfig(),
  (value) => ({ keys: Object.keys(value).sort() }),
));
results.push(await bench(
  "loadProjectConfig",
  () => config.loadProjectConfig(snapshot),
  (value) => ({ keys: Object.keys(value).sort() }),
));
results.push(await bench(
  "loadFullConfig",
  () => config.loadFullConfig(snapshot),
  (value) => ({ keys: Object.keys(value).sort(), commandCount: Object.keys(value.commands ?? {}).length }),
));
results.push(await bench(
  "flowRead",
  () => Bun.file(fixture).text(),
  (value) => ({ chars: value.length }),
));
results.push(await bench(
  "parseFrontmatter",
  () => parse.parseFrontmatter(fixtureContent),
  (value) => ({ frontmatterKeys: Object.keys(value.frontmatter).sort(), bodyChars: value.body.length }),
));
results.push(await bench(
  "flowReadAndParse",
  async () => parse.parseFrontmatter(await Bun.file(fixture).text()),
  (value) => ({ frontmatterKeys: Object.keys(value.frontmatter).sort(), bodyChars: value.body.length }),
));
results.push(await bench(
  "cheapImportCandidate",
  () => hasImportCandidate(fixtureBody),
  (value) => value,
));
results.push(await bench(
  "parseImportsAst",
  () => importParser.parseImports(fixtureBody),
  (value) => ({ actions: value.length }),
));
results.push(await bench(
  "hasContentImportsCurrent",
  () => imports.hasContentImports(fixtureBody),
  (value) => value,
));
results.push(await bench(
  "hasCommandImportsCurrent",
  () => imports.hasCommandImports(fixtureBody),
  (value) => value,
));
results.push(await bench(
  "findAgentFiles",
  () => cli.findAgentFiles(),
  (value) => ({
    count: value.length,
    sources: Object.fromEntries(
      [...new Set<string>(value.map((file: { source: string }) => file.source))]
        .sort()
        .map((source) => [source, value.filter((file: { source: string }) => file.source === source).length]),
    ),
  }),
));

const fixtureAgent = [{ name: basename(fixture), path: fixture, source: "static-work-fixture" }];
results.push(await bench(
  "buildWorkbenchStatusMapOneFixture",
  () => workbenchStatus.buildWorkbenchStatusMap(fixtureAgent),
  (value) => ({ count: Object.keys(value).length }),
));
results.push(await bench(
  "mdflowVersion",
  () => compat.mdflowVersion(),
  (value) => value,
));

// Logger is last because each init creates a pino destination. Capture both the
// module-import mutation and initLogger's agent-directory/file mutation.
const logBase = join(isolatedHome, ".mdflow", "logs");
const loggerBeforeImport = await inventory(join(isolatedHome, ".mdflow"));
const loggerImport = await timed(() => import(moduleUrl("src/logger.ts")));
const loggerAfterImport = await inventory(join(isolatedHome, ".mdflow"));
const logger: any = loggerImport.value;
results.push(await bench(
  "initLogger",
  () => logger.initLogger(fixture),
  (value) => ({ level: value.level }),
));
await Bun.sleep(25);
const loggerAfterInit = await inventory(join(isolatedHome, ".mdflow"));

process.stdout.write(`${JSON.stringify({
  metadata: {
    snapshot,
    fixture,
    scratch,
    isolatedHome,
    cwd: process.cwd(),
    warmups: WARMUPS,
    samples: SAMPLES,
    pathDirectoryCount: (process.env.PATH ?? "").split(":").filter(Boolean).length,
    sourceHashes: {
      index: await sha256(indexPath),
      cliRunner: await sha256(runnerPath),
    },
  },
  fixture: {
    chars: fixtureContent.length,
    bodyChars: fixtureBody.length,
    importCandidate: hasImportCandidate(fixtureBody),
  },
  results,
  loggerSideEffects: {
    logBase,
    importMs: loggerImport.ms,
    beforeImport: loggerBeforeImport,
    afterImport: loggerAfterImport,
    afterInit: loggerAfterInit,
  },
}, null, 2)}\n`);
