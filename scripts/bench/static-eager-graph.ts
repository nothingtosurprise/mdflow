#!/usr/bin/env bun

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

const rootFlag = Bun.argv.indexOf("--root");
const root = rootFlag >= 0 && Bun.argv[rootFlag + 1]
  ? resolve(Bun.argv[rootFlag + 1]!)
  : resolve(import.meta.dir, "../..");
const entries = Bun.argv.slice(2).filter((item, index, all) => item !== "--root" && all[index - 1] !== "--root");
if (entries.length === 0) throw new Error("Pass one or more entry modules");

const transpiler = new Bun.Transpiler({ loader: "tsx" });

function resolveLocal(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, resolve(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const seen = new Set<string>();
const externals = new Set<string>();
const edges: Array<[string, string]> = [];

function visit(file: string): void {
  file = resolve(root, file);
  if (seen.has(file)) return;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const imports = transpiler.scan(source).imports.filter((item) => item.kind === "import-statement");
  for (const item of imports) {
    const specifier = item.path;
    const local = resolveLocal(file, specifier);
    if (local) {
      edges.push([file, local]);
      visit(local);
    } else {
      externals.add(specifier);
      edges.push([file, specifier]);
    }
  }
}

for (const entry of entries) visit(entry);

const display = (item: string) => item.startsWith(root) ? relative(root, item) : item;
console.log(`nodes=${seen.size} externals=${externals.size} edges=${edges.length}`);
console.log("NODES");
for (const file of [...seen].sort()) console.log(display(file));
console.log("EXTERNALS");
for (const item of [...externals].sort()) console.log(item);
console.log("EDGES");
for (const [from, to] of edges) console.log(`${display(from)} -> ${display(to)}`);
