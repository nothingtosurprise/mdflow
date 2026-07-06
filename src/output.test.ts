import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectUnifiedDiff,
  extractStructured,
  sinkOutput,
  validateOutput,
} from "./output";

describe("extractStructured", () => {
  test("test_extractStructured_returns_json_from_markdown_json_fence", () => {
    const stdout = [
      "Here is your result:",
      "",
      "```json",
      "{",
      '  "task": "done",',
      '  "count": 2',
      "}",
      "```",
      "",
      "Thanks.",
    ].join("\n");

    const result = extractStructured(stdout, "json");
    expect(result).toEqual({ task: "done", count: 2 });
  });

  test("test_extractStructured_returns_json_from_raw_object_in_stdout", () => {
    const stdout = 'Result payload: {"task":"done","count":3} end.';

    const result = extractStructured(stdout, "json");
    expect(result).toEqual({ task: "done", count: 3 });
  });
});

describe("validateOutput", () => {
  let tempDir = "";
  let schemaPath = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(process.cwd(), ".mdflow-output-test-"));
    schemaPath = join(tempDir, "schema.ts");

    writeFileSync(
      schemaPath,
      [
        'import { z } from "zod";',
        "",
        "export const MySchema = z.object({",
        '  task: z.literal("done"),',
        "  count: z.number().int().min(0),",
        "});",
        "",
      ].join("\n"),
      "utf-8"
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("test_validateOutput_returns_success_true_when_value_matches_schema", async () => {
    const result = await validateOutput(`${schemaPath}#MySchema`, {
      task: "done",
      count: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success result");
    }

    expect(result.data).toEqual({ task: "done", count: 1 });
  });

  test("test_validateOutput_returns_success_false_when_value_fails_schema", async () => {
    const result = await validateOutput(`${schemaPath}#MySchema`, {
      task: "done",
      count: "invalid",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure result");
    }

    expect(result.error).toContain("Schema validation failed");
  });
});

describe("sinkOutput", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(process.cwd(), ".mdflow-output-sink-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("test_sinkOutput_writes_content_when_save_path_is_set", async () => {
    const savePath = join(tempDir, "result.txt");

    const result = await sinkOutput({ save: savePath }, "saved output");

    expect(result.savedTo).toBe(savePath);
    expect(result.applied).toBe(false);
    expect(readFileSync(savePath, "utf-8")).toBe("saved output");
  });

  test("test_sinkOutput_skips_git_apply_when_content_is_not_unified_diff", async () => {
    const result = await sinkOutput({ apply: true }, "this is not a diff");

    expect(result.applied).toBe(false);
  });
});

describe("detectUnifiedDiff", () => {
  test("test_detectUnifiedDiff_returns_true_when_unified_diff_headers_exist", () => {
    const stdout = [
      "Patch to apply:",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -1,2 +1,2 @@",
      "-console.log('old');",
      "+console.log('new');",
    ].join("\n");

    expect(detectUnifiedDiff(stdout)).toBe(true);
  });
});
