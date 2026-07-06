import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandImports } from "./imports";
import { MAX_INPUT_SIZE } from "./limits";

let testDir: string;

describe("imports failure coverage", () => {
  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "imports-failure-"));
    await mkdir(join(testDir, "glob"), { recursive: true });
    await Bun.write(join(testDir, "lines.txt"), "Line 1\nLine 2\nLine 3");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty content for invalid descending line ranges", async () => {
    const result = await expandImports("@./lines.txt:3-1", testDir);
    expect(result).toBe("");
  });

  it("throws when line range syntax is malformed", async () => {
    await expect(expandImports("@./lines.txt:abc-def", testDir)).rejects.toThrow("Import not found");
  });

  it("throws when glob expansion includes oversized files", async () => {
    await Bun.write(join(testDir, "glob", "too-large.ts"), Buffer.alloc(MAX_INPUT_SIZE + 1, "x"));
    await expect(expandImports("@./glob/*.ts", testDir)).rejects.toThrow("exceeds 10MB limit");
  });

  it("throws on missing file imports", async () => {
    await expect(expandImports("@./does-not-exist.md", testDir)).rejects.toThrow("Import not found");
  });

  it("throws on multi-hop circular imports", async () => {
    await Bun.write(join(testDir, "a.md"), "@./b.md");
    await Bun.write(join(testDir, "b.md"), "@./c.md");
    await Bun.write(join(testDir, "c.md"), "@./a.md");

    await expect(expandImports("@./a.md", testDir)).rejects.toThrow("Circular import detected");
  });

  it("throws when URL fetch returns an HTTP error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      },
    });

    try {
      await expect(
        expandImports(`@http://127.0.0.1:${server.port}/missing`, testDir)
      ).rejects.toThrow("Failed to fetch URL");
    } finally {
      server.stop(true);
    }
  });

  it("throws when URL content type is unsupported", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html><body>unsupported</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    try {
      await expect(
        expandImports(`@http://127.0.0.1:${server.port}/html`, testDir)
      ).rejects.toThrow("unsupported content type");
    } finally {
      server.stop(true);
    }
  });
});
