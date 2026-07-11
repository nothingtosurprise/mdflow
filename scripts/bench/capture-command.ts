#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function requiredFlag(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const outputPath = resolve(requiredFlag("--out"));
const cwd = resolve(requiredFlag("--cwd"));
const command = requiredFlag("--command");

if (await Bun.file(outputPath).exists()) {
  throw new Error(`Refusing to overwrite existing raw log: ${outputPath}`);
}

const startedAt = new Date();
const startNs = process.hrtime.bigint();
const child = Bun.spawn(["zsh", "-lc", command], {
  cwd,
  env: process.env,
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;

const raw = [
  `started_at: ${startedAt.toISOString()}`,
  `cwd: ${cwd}`,
  `command: ${command}`,
  `exit_code: ${exitCode}`,
  `duration_ms: ${durationMs.toFixed(3)}`,
  "",
  "--- stdout ---",
  stdout,
  "--- stderr ---",
  stderr,
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, raw);
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
