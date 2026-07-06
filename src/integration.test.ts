/**
 * Integration tests for mdflow
 *
 * These tests verify end-to-end behavior including:
 * - Command argument building
 * - Environment variable handling
 * - Dry-run output
 * - File resolution
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs, extractPositionalMappings, extractEnvVars } from "./command";
import { expandImports } from "./imports";
import { substituteTemplateVars, extractTemplateVars } from "./template";
import { parseFrontmatter } from "./parse";
import { validateFrontmatter } from "./schema";
import type { AgentFrontmatter } from "./types";

describe("integration: command building", () => {
  it("builds correct args from typical claude frontmatter", () => {
    const frontmatter: AgentFrontmatter = {
      model: "opus",
      print: true,
      "add-dir": ["./src", "./tests"],
    };

    const templateVars = new Set<string>();
    const args = buildArgs(frontmatter, templateVars);

    expect(args).toContain("--model");
    expect(args).toContain("opus");
    expect(args).toContain("--print");
    // add-dir is a variadic flag, so it uses --flag=value format
    expect(args).toContain("--add-dir=./src");
    expect(args).toContain("--add-dir=./tests");
    expect(args.filter(a => a.startsWith("--add-dir="))).toHaveLength(2);
  });

  it("excludes system keys from args", () => {
    const frontmatter: AgentFrontmatter = {
      model: "opus",
      _env: { API_KEY: "secret" },
      _inputs: ["message"],
      _interactive: true,
      _subcommand: "exec",
    };

    const templateVars = new Set<string>();
    const args = buildArgs(frontmatter, templateVars);

    expect(args).toContain("--model");
    expect(args).not.toContain("--_env");
    expect(args).not.toContain("--_inputs");
    expect(args).not.toContain("--_interactive");
    expect(args).not.toContain("--_subcommand");
  });

  it("excludes template variables from args", () => {
    const frontmatter: AgentFrontmatter = {
      model: "opus",
      _name: "default",
      _target: "./src",
    };

    const templateVars = new Set(["_name", "_target"]);
    const args = buildArgs(frontmatter, templateVars);

    expect(args).toContain("--model");
    expect(args).not.toContain("--_name");
    expect(args).not.toContain("--_target");
  });

  it("handles positional mappings correctly", () => {
    const frontmatter: AgentFrontmatter = {
      model: "opus",
      $1: "prompt",
      $2: "context",
    };

    const mappings = extractPositionalMappings(frontmatter);

    expect(mappings.get(1)).toBe("prompt");
    expect(mappings.get(2)).toBe("context");
  });

  it("extracts environment variables from _env", () => {
    const frontmatter: AgentFrontmatter = {
      _env: { API_KEY: "secret", DEBUG: "true" },
    };

    const envVars = extractEnvVars(frontmatter);

    expect(envVars).toEqual({ API_KEY: "secret", DEBUG: "true" });
  });
});

describe("integration: template substitution", () => {
  it("substitutes template variables in content", () => {
    const content = "Refactor {{ _target }} to match {{ _reference }}";
    const vars = { _target: "src/utils.ts", _reference: "src/main.ts" };

    const result = substituteTemplateVars(content, vars);

    expect(result).toBe("Refactor src/utils.ts to match src/main.ts");
  });

  it("extracts only underscore-prefixed variables", () => {
    const content = "Use {{ model }} with {{ _custom }}";

    const vars = extractTemplateVars(content);

    expect(vars).toContain("_custom");
    expect(vars).not.toContain("model");
  });

  it("handles strict mode for missing variables", () => {
    const content = "Hello {{ _name }}";

    expect(() => {
      substituteTemplateVars(content, {}, { strict: true });
    }).toThrow("Missing required template variable: _name");
  });

  it("uses default filter for fallback values", () => {
    const content = 'Hello {{ _name | default: "World" }}';

    const result = substituteTemplateVars(content, {});

    expect(result).toBe("Hello World");
  });
});

describe("integration: file imports", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "integration-test-"));

    await Bun.write(join(testDir, "simple.md"), "Simple content");
    await Bun.write(join(testDir, "with-import.md"), "Before @./simple.md after");
    await Bun.write(join(testDir, "lines.txt"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    await mkdir(join(testDir, "subdir"), { recursive: true });
    await Bun.write(join(testDir, "subdir/nested.md"), "Nested file");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  it("expands simple file import", async () => {
    const content = "@./simple.md";
    const result = await expandImports(content, testDir);
    expect(result).toBe("Simple content");
  });

  it("expands nested file import", async () => {
    const content = "@./with-import.md";
    const result = await expandImports(content, testDir);
    expect(result).toBe("Before Simple content after");
  });

  it("expands line range import", async () => {
    const content = "@./lines.txt:2-4";
    const result = await expandImports(content, testDir);
    expect(result).toBe("Line 2\nLine 3\nLine 4");
  });

  it("expands subdirectory import", async () => {
    const content = "@./subdir/nested.md";
    const result = await expandImports(content, testDir);
    expect(result).toBe("Nested file");
  });

  it("handles command inline execution", async () => {
    const content = "!`echo hello`";
    const result = await expandImports(content, testDir);
    expect(result).toContain("hello");
  });
});

describe("integration: full pipeline simulation", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pipeline-test-"));

    // Create a mock agent file content
    await Bun.write(
      join(testDir, "config.yaml"),
      "api_key: test123\nbase_url: https://api.example.com"
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  it("simulates full agent processing pipeline", async () => {
    // Step 1: Parse and validate frontmatter
    const frontmatter = validateFrontmatter({
      model: "opus",
      print: true,
      _env: { DEBUG: "true" },
      _name: "test-agent",
    });

    expect(frontmatter.model).toBe("opus");
    expect(frontmatter._env).toEqual({ DEBUG: "true" });

    // Step 2: Extract template variables
    const body = "Deploy {{ _name }} to production\nConfig: @./config.yaml";
    const templateVars = extractTemplateVars(body);
    expect(templateVars).toContain("_name");

    // Step 3: Expand imports
    const expandedBody = await expandImports(body, testDir);
    expect(expandedBody).toContain("api_key: test123");

    // Step 4: Substitute template variables
    const finalBody = substituteTemplateVars(expandedBody, {
      _name: frontmatter._name as string,
    });
    expect(finalBody).toContain("Deploy test-agent to production");

    // Step 5: Build command args
    const args = buildArgs(frontmatter as AgentFrontmatter, new Set(templateVars));
    expect(args).toContain("--model");
    expect(args).toContain("--print");
    expect(args).not.toContain("--_name");

    // Step 6: Extract env vars
    const envVars = extractEnvVars(frontmatter as AgentFrontmatter);
    expect(envVars).toEqual({ DEBUG: "true" });
  });

  it("parses an agent .md file and builds final command inputs", async () => {
    await Bun.write(join(testDir, "docs.md"), "release-notes: stable");
    const agentFile = join(testDir, "deploy.claude.md");

    await Bun.write(
      agentFile,
      `#!/usr/bin/env md
---
model: opus
print: true
$1: prompt
_name: release-agent
_env:
  DEPLOY_ENV: prod
---
Deploy {{ _name }}
Config: @./docs.md`
    );

    // Step 1: Read and parse .md file (shebang + YAML frontmatter + body)
    const rawAgent = await Bun.file(agentFile).text();
    const parsed = parseFrontmatter(rawAgent);

    expect(parsed.frontmatter.model).toBe("opus");
    expect(parsed.body).toContain("Deploy {{ _name }}");

    // Step 2: Expand imports from body
    const expandedBody = await expandImports(parsed.body, testDir);
    expect(expandedBody).toContain("release-notes: stable");

    // Step 3: Resolve template variables in content
    const bodyTemplateVars = extractTemplateVars(expandedBody);
    const renderedBody = substituteTemplateVars(expandedBody, {
      _name: parsed.frontmatter._name as string,
    }, { strict: true });
    expect(renderedBody).toContain("Deploy release-agent");

    // Step 4: Build CLI args and env from parsed frontmatter
    const args = buildArgs(parsed.frontmatter as AgentFrontmatter, new Set(bodyTemplateVars));
    const envVars = extractEnvVars(parsed.frontmatter as AgentFrontmatter);
    const positional = extractPositionalMappings(parsed.frontmatter as AgentFrontmatter);

    expect(args).toContain("--model");
    expect(args).toContain("opus");
    expect(args).toContain("--print");
    expect(args).not.toContain("--_name");
    expect(envVars).toEqual({ DEPLOY_ENV: "prod" });
    expect(positional.get(1)).toBe("prompt");
  });
});

describe("integration: error handling", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "error-test-"));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  it("throws on missing file import", async () => {
    const content = "@./nonexistent.md";
    await expect(expandImports(content, testDir)).rejects.toThrow("Import not found");
  });

  it("throws on circular import", async () => {
    await Bun.write(join(testDir, "a.md"), "@./b.md");
    await Bun.write(join(testDir, "b.md"), "@./a.md");

    const content = "@./a.md";
    await expect(expandImports(content, testDir)).rejects.toThrow("Circular import");
  });

  it("handles missing symbol extraction gracefully", async () => {
    await Bun.write(join(testDir, "code.ts"), "export const foo = 1;");

    const content = "@./code.ts#NonExistent";
    await expect(expandImports(content, testDir)).rejects.toThrow("Symbol");
  });
});
