import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { providerRegistry, resolveContextProviderImport, runProvider } from "./context-providers";

const createdRepos: string[] = [];

function runBinary(
  cwd: string,
  command: string,
  args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function runGit(cwd: string, args: string[]): string {
  const result = runBinary(cwd, "git", args);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (exit=${result.exitCode})\n${result.stderr || result.stdout}`
    );
  }

  return result.stdout;
}

async function createGitRepoFixture(): Promise<string> {
  if (!Bun.which("git")) {
    throw new Error("git binary is required for context provider tests");
  }

  const repoDir = await mkdtemp(join(tmpdir(), "context-provider-test-"));
  createdRepos.push(repoDir);

  runGit(repoDir, ["init"]);
  runGit(repoDir, ["config", "user.email", "test@example.com"]);
  runGit(repoDir, ["config", "user.name", "Context Provider Tests"]);

  await Bun.write(join(repoDir, "tracked.txt"), "line-1\nline-2\n");
  runGit(repoDir, ["add", "tracked.txt"]);
  runGit(repoDir, ["commit", "-m", "initial commit"]);

  return repoDir;
}

afterAll(async () => {
  for (const repo of createdRepos) {
    await rm(repo, { recursive: true, force: true });
  }
});

describe("provider registry", () => {
  test("test_providerRegistry_contains_expected_context_provider_commands", () => {
    expect(providerRegistry["git:diff"].buildCommand()).toEqual(["git", "diff"]);
    expect(providerRegistry["git:staged"].buildCommand()).toEqual(["git", "diff", "--staged"]);
    expect(providerRegistry["git:status"].buildCommand()).toEqual(["git", "status", "--porcelain"]);
    expect(providerRegistry["git:log"].buildCommand("3")).toEqual(["git", "log", "--oneline", "-3"]);
    expect(providerRegistry.tree.buildCommand()).toEqual([
      "find",
      ".",
      "-type",
      "f",
      "-not",
      "-path",
      "./.git/*",
    ]);
    expect(providerRegistry.rg.buildCommand("needle")).toEqual([
      "rg",
      "--no-heading",
      "--",
      "needle",
      ".",
    ]);
  });

  test("test_runProvider_throws_when_provider_name_is_unknown", async () => {
    await expect(runProvider("unknown-provider")).rejects.toThrow("Unknown context provider");
  });

  test("test_runProvider_truncates_output_when_budget_is_tiny", async () => {
    if (!Bun.which("find")) {
      return;
    }

    const output = await runProvider("tree", undefined, 1);
    expect(output.endsWith("... (truncated)")).toBe(true);
  });
});

describe("resolveContextProviderImport", () => {
  test("test_resolveContextProviderImport_runs_git_status_when_repository_has_changes", async () => {
    if (!Bun.which("git")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    await Bun.write(join(repoDir, "tracked.txt"), "line-1\nline-2\nline-3\n");

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "git:status",
        original: "@git:status",
        index: 0,
      },
      { cwd: repoDir }
    );

    expect(output).toContain("tracked.txt");
  });

  test("test_resolveContextProviderImport_runs_git_staged_when_file_is_staged", async () => {
    if (!Bun.which("git")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    await Bun.write(join(repoDir, "tracked.txt"), "line-1\nline-2\nline-3\n");
    runGit(repoDir, ["add", "tracked.txt"]);

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "git:staged",
        original: "@git:staged",
        index: 0,
      },
      { cwd: repoDir }
    );

    expect(output).toContain("+line-3");
  });

  test("test_resolveContextProviderImport_runs_git_log_with_requested_count", async () => {
    if (!Bun.which("git")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    await Bun.write(join(repoDir, "tracked.txt"), "line-1\nline-2\nline-3\n");
    runGit(repoDir, ["add", "tracked.txt"]);
    runGit(repoDir, ["commit", "-m", "second commit"]);

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "git:log",
        argument: "1",
        original: "@git:log(1)",
        index: 0,
      },
      { cwd: repoDir }
    );

    expect(output).toContain("second commit");
    expect(output.split("\n")).toHaveLength(1);
  });

  test("test_resolveContextProviderImport_runs_tree_without_git_internal_files", async () => {
    if (!Bun.which("find")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    await mkdir(join(repoDir, "notes"), { recursive: true });
    await Bun.write(join(repoDir, "notes", "entry.md"), "entry\n");

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "tree",
        original: "@tree",
        index: 0,
      },
      { cwd: repoDir }
    );

    expect(output).toContain("notes/entry.md");
    expect(output).not.toContain(".git/");
  });

  test("test_resolveContextProviderImport_runs_rg_with_supplied_pattern", async () => {
    if (!Bun.which("rg")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    await Bun.write(join(repoDir, "notes.md"), "needle value\n");

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "rg",
        argument: "needle",
        original: "@rg:needle",
        index: 0,
      },
      { cwd: repoDir }
    );

    expect(output).toContain("needle value");
  });

  test("test_resolveContextProviderImport_uses_git_diff_stat_when_diff_exceeds_budget", async () => {
    if (!Bun.which("git")) {
      return;
    }

    const repoDir = await createGitRepoFixture();
    const expanded =
      Array.from({ length: 300 }, (_, index) => `line-${index + 1}`).join("\n") + "\n";
    await Bun.write(join(repoDir, "tracked.txt"), expanded);

    const output = await resolveContextProviderImport(
      {
        type: "provider",
        provider: "git:diff",
        original: "@git:diff",
        index: 0,
      },
      { cwd: repoDir, maxTokens: 80 }
    );

    expect(output).toContain("tracked.txt |");
    expect(output).not.toContain("@@");
  });
});
