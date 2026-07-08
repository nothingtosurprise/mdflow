import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalFlowPath, findRepositoryRoot } from "./evolution-core";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function copyEntry(root: string, destination: string, relativePath: string): void {
  const source = join(root, relativePath);
  const target = join(destination, relativePath);
  if (!existsSync(source)) return;
  const stat = lstatSync(source);
  mkdirSync(dirname(target), { recursive: true });
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(source);
    const resolvedTarget = realpathSync(resolve(dirname(source), link));
    if (!inside(root, resolvedTarget)) {
      throw new Error(`Workspace snapshot refused symlink escaping the repository: ${relativePath}`);
    }
    if (lstatSync(resolvedTarget).isDirectory()) {
      throw new Error(`Workspace snapshot refuses directory symlinks: ${relativePath}`);
    } else {
      copyFileSync(resolvedTarget, target);
    }
    return;
  }
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    return;
  }
  copyFileSync(source, target);
}

function gitFiles(root: string): string[] | undefined {
  try {
    const result = Bun.spawnSync(
      ["git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
      { stdout: "pipe", stderr: "ignore" }
    );
    if (result.exitCode !== 0) return undefined;
    return result.stdout.toString().split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

function copyTree(root: string, destination: string, current = root): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if ([".git", ".mdflow", ".artifacts", "node_modules"].includes(entry.name)) continue;
    const source = join(current, entry.name);
    const rel = relative(root, source);
    if (entry.isDirectory()) {
      mkdirSync(join(destination, rel), { recursive: true });
      copyTree(root, destination, source);
    } else {
      copyEntry(root, destination, rel);
    }
  }
}

/**
 * Create an off-path snapshot of the flow's repository and return the matching
 * flow path inside it. Ignored build products and secrets are deliberately not
 * copied. Symlinks are dereferenced only when they remain inside the repo.
 */
export function createEvolutionWorkspace(
  sourceFlowPath: string,
  workspaceRoot: string,
  flowContent: string
): { root: string; flowPath: string } {
  const sourceFlow = canonicalFlowPath(sourceFlowPath);
  const repoRoot = findRepositoryRoot(sourceFlow) ?? dirname(sourceFlow);
  mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });

  const files = gitFiles(repoRoot);
  if (files) {
    for (const file of files) copyEntry(repoRoot, workspaceRoot, file);
  } else {
    copyTree(repoRoot, workspaceRoot);
  }

  const flowRelative = relative(repoRoot, sourceFlow);
  const flowPath = join(workspaceRoot, flowRelative);
  mkdirSync(dirname(flowPath), { recursive: true });
  writeFileSync(flowPath, flowContent, { mode: 0o600 });
  return { root: workspaceRoot, flowPath };
}
