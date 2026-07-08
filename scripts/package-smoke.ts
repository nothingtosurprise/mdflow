import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(command: string[], cwd: string): Promise<SpawnResult> {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function requireSuccess(label: string, result: SpawnResult): void {
  if (result.exitCode === 0) return;
  throw new Error(`${label} failed (${result.exitCode})\n${result.stderr || result.stdout}`);
}

const root = resolve(import.meta.dir, "..");
const temp = await mkdtemp(join(tmpdir(), "mdflow-package-smoke-"));

try {
  const packed = await run(["npm", "pack", "--json", "--pack-destination", temp], root);
  requireSuccess("npm pack", packed);
  const metadata = JSON.parse(packed.stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const artifact = metadata[0];
  if (!artifact) throw new Error("npm pack returned no artifact metadata");

  const paths = new Set(artifact.files.map((file) => file.path));
  for (const expected of ["LICENSE", "README.md", "bin/mdflow.mjs", "src/index.ts"]) {
    if (!paths.has(expected)) throw new Error(`packed artifact is missing ${expected}`);
  }

  const consumer = join(temp, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  const installed = await run([
    "npm",
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(temp, artifact.filename),
  ], consumer);
  requireSuccess("clean tarball install", installed);

  const help = await run([
    "node",
    join(consumer, "node_modules", "mdflow", "bin", "mdflow.mjs"),
    "--help",
  ], consumer);
  requireSuccess("installed mdflow --help", help);
  if (!help.stdout.includes("Usage: md")) {
    throw new Error("installed mdflow help did not contain the CLI usage banner");
  }

  console.log(`package smoke passed: ${artifact.filename}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
