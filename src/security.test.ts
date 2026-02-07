import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./command";
import { loadEnvFiles } from "./env";
import { expandImports } from "./imports";
import {
  detectSensitiveEnvVars,
  escapeShellArg,
  sanitizePath,
  validateUrl,
} from "./security";

describe("sanitizePath", () => {
  test("test_sanitizePath_allows_paths_within_project_root", () => {
    const projectRoot = "/project";
    const baseDir = "/project/docs";
    const sanitized = sanitizePath("./guide.md", { baseDir, projectRoot });

    expect(sanitized).toBe(join(baseDir, "guide.md"));
  });

  test("test_sanitizePath_blocks_parent_traversal_outside_project_root", () => {
    const projectRoot = "/project";
    const baseDir = "/project/docs";

    expect(() =>
      sanitizePath("../../etc/passwd", { baseDir, projectRoot })
    ).toThrow("Path traversal blocked");
  });

  test("test_sanitizePath_allows_parent_navigation_inside_project_root", () => {
    const projectRoot = "/project";
    const baseDir = "/project/docs/nested";
    const sanitized = sanitizePath("../README.md", { baseDir, projectRoot });

    expect(sanitized).toBe("/project/docs/README.md");
  });
});

describe("validateUrl", () => {
  test("test_validateUrl_accepts_http_and_https", () => {
    expect(validateUrl("https://example.com/docs").hostname).toBe("example.com");
    expect(validateUrl("http://example.com/docs").hostname).toBe("example.com");
  });

  test("test_validateUrl_rejects_non_http_protocols", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow("Unsupported URL protocol");
  });

  test("test_validateUrl_blocks_hosts_in_blocklist", () => {
    expect(() =>
      validateUrl("https://evil.example.com", { blocklist: ["*.example.com"] })
    ).toThrow("blocked by policy");
  });

  test("test_validateUrl_requires_host_in_allowlist_when_present", () => {
    expect(() =>
      validateUrl("https://example.com", { allowlist: ["trusted.com"] })
    ).toThrow("not in allowlist");

    expect(
      validateUrl("https://api.trusted.com/path", { allowlist: ["*.trusted.com"] }).hostname
    ).toBe("api.trusted.com");
  });
});

describe("escapeShellArg", () => {
  test("test_escapeShellArg_escapes_posix_quotes", () => {
    const escaped = escapeShellArg("abc'def");
    expect(escaped).toBe("'abc'\"'\"'def'");
  });

  test("test_escapeShellArg_escapes_win32_metacharacters", () => {
    const escaped = escapeShellArg("a&b\"c", "win32");
    expect(escaped).toBe("\"a^&b\"\"c\"");
  });
});

describe("detectSensitiveEnvVars", () => {
  test("test_detectSensitiveEnvVars_returns_sensitive_keys_only", () => {
    const result = detectSensitiveEnvVars({
      API_KEY: "secret",
      DB_PASSWORD: "pw",
      NEXT_PUBLIC_API_URL: "https://example.com",
      NODE_ENV: "test",
    });

    expect(result).toEqual(["API_KEY", "DB_PASSWORD"]);
  });

  test("test_detectSensitiveEnvVars_accepts_iterables", () => {
    const result = detectSensitiveEnvVars(["TOKEN", "VITE_PUBLIC_KEY", "AUTH_SECRET"]);
    expect(result).toEqual(["AUTH_SECRET", "TOKEN"]);
  });
});

describe("imports security integration", () => {
  test("test_expandImports_blocks_paths_outside_invocation_project_root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "security-project-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "security-external-"));
    const agentDir = join(projectRoot, "agents");
    const externalFile = join(externalRoot, "secret.md");

    await mkdir(agentDir, { recursive: true });
    await Bun.write(externalFile, "secret");

    try {
      await expect(
        expandImports(`@${externalFile}`, agentDir, new Set(), false, {
          invocationCwd: projectRoot,
        })
      ).rejects.toThrow("Blocked import path");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  test("test_expandImports_enforces_url_blocklist_policy_from_env", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "security-url-"));

    try {
      await expect(
        expandImports("@https://example.com", projectRoot, new Set(), false, {
          env: {
            ...process.env,
            MDFLOW_IMPORT_URL_BLOCKLIST: "example.com",
          },
        })
      ).rejects.toThrow("Blocked URL import");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("env security integration", () => {
  test("test_loadEnvFiles_warns_when_sensitive_keys_are_present", async () => {
    const envDir = await mkdtemp(join(tmpdir(), "security-env-"));
    await Bun.write(join(envDir, ".env"), "API_KEY=secret\nNEXT_PUBLIC_SITE=example.com\n");

    const originalConsoleError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    try {
      await loadEnvFiles(envDir);
      expect(logs.some((line) => line.includes("[env][security]"))).toBe(true);
      expect(logs.some((line) => line.includes("API_KEY"))).toBe(true);
    } finally {
      console.error = originalConsoleError;
      await rm(envDir, { recursive: true, force: true });
    }
  });
});

describe("command security integration", () => {
  test("test_runCommand_rejects_null_byte_arguments", async () => {
    const result = await runCommand({
      command: "echo",
      args: ["safe", "bad\0arg"],
      positionals: [],
      positionalMappings: new Map(),
      captureOutput: true,
    });

    expect(result.exitCode).toBe(127);
  });
});
