import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { analyzeAgent, formatExplainOutput } from "./explain";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";

describe("explain", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "explain-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("analyzeAgent", () => {
    it("analyzes a simple agent file", async () => {
      const agentPath = join(tempDir, "test.claude.md");
      await writeFile(agentPath, `---
model: opus
verbose: true
---
Hello world`);

      const result = await analyzeAgent(agentPath);

      expect(result.command).toBe("claude");
      expect(result.commandSource).toContain("Filename pattern");
      expect(result.originalFrontmatter.model).toBe("opus");
      expect(result.originalFrontmatter.verbose).toBe(true);
      expect(result.finalPrompt).toContain("Hello world");
    });

    it("detects interactive mode from filename", async () => {
      const agentPath = join(tempDir, "test.i.claude.md");
      await writeFile(agentPath, `Test prompt`);

      const result = await analyzeAgent(agentPath);

      expect(result.interactiveMode).toBe(true);
      expect(result.interactiveModeSource).toContain("Filename");
    });

    it("extracts env keys with redacted values", async () => {
      const agentPath = join(tempDir, "env-test.claude.md");
      await writeFile(agentPath, `---
_env:
  API_KEY: secret123
  OTHER_KEY: hidden
---
Test`);

      const result = await analyzeAgent(agentPath);

      expect(result.envKeys).toContain("API_KEY");
      expect(result.envKeys).toContain("OTHER_KEY");
    });

    it("includes token usage info", async () => {
      const agentPath = join(tempDir, "token-test.claude.md");
      await writeFile(agentPath, `---
model: opus
---
This is a test prompt with some words`);

      const result = await analyzeAgent(agentPath);

      expect(result.tokenUsage.tokens).toBeGreaterThan(0);
      expect(result.tokenUsage.limit).toBeGreaterThan(0);
      expect(result.tokenUsage.percentage).toBeGreaterThanOrEqual(0);
    });

    it("uses the real engine ladder and preserves the full codex profile", async () => {
      const projectDir = join(tempDir, "codex-project");
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        join(projectDir, ".mdflow.yaml"),
        `engine: codex
commands:
  codex:
    config:
      - profile=project
`
      );
      const agentPath = join(projectDir, "flow.md");
      await writeFile(agentPath, `---
model: gpt-5.5
config: model_reasoning_effort="medium"
---
Inspect the project`);

      const result = await analyzeAgent(agentPath, [], projectDir);

      expect(result.command).toBe("codex");
      expect(result.commandSource).toContain("Project config");
      expect(result.finalArgs).toContain("--ignore-user-config");
      expect(result.finalArgs).toContain("--ephemeral");
      expect(result.finalFrontmatter.config).toEqual([
        "profile=project",
        "project_doc_max_bytes=0",
        'model_reasoning_effort="medium"',
      ]);
    });
  });

  describe("formatExplainOutput", () => {
    it("formats output with all sections", async () => {
      const agentPath = join(tempDir, "format-test.claude.md");
      await writeFile(agentPath, `---
model: sonnet
---
Test prompt`);

      const result = await analyzeAgent(agentPath);
      const output = formatExplainOutput(result);

      expect(output).toContain("MD EXPLAIN");
      expect(output).toContain("COMMAND");
      expect(output).toContain("MODE");
      expect(output).toContain("CONFIGURATION PRECEDENCE");
      expect(output).toContain("TOKEN USAGE");
      expect(output).toContain("FINAL PROMPT");
    });
  });
});
