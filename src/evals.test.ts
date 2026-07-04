/**
 * Tests for the flow eval harness. All free: the flow runner is injected, so
 * no engine is ever spawned and no model turn is ever spent here.
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveEvalSuitePath,
  runEvalSuite,
  recordEvalResult,
  readEvalLedger,
  type EvalCase,
  type FlowRunner,
} from "./evals";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mdflow-evals-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const okRunner: FlowRunner = async () => ({ stdout: "hello", stderr: "", exitCode: 0 });

describe("resolveEvalSuitePath", () => {
  test("maps flow files to colocated eval suites", () => {
    expect(resolveEvalSuitePath("flows/jq.md")).toBe("flows/jq.eval.ts");
    expect(resolveEvalSuitePath("flows/review.claude.md")).toBe("flows/review.claude.eval.ts");
  });
});

describe("runEvalSuite", () => {
  test("passing and failing checks are tallied with reasons", async () => {
    const cases: EvalCase[] = [
      { name: "passes", check: ({ stdout }) => (stdout.includes("hello") ? null : "no greeting") },
      { name: "fails", check: () => "wrong answer" },
    ];

    const lines: string[] = [];
    const outcome = await runEvalSuite({
      flowPath: "fake.md",
      cases,
      runFlow: okRunner,
      log: (l) => lines.push(l),
      noLedger: true,
    });

    expect(outcome.pass).toBe(1);
    expect(outcome.fail).toBe(1);
    expect(outcome.failures).toEqual(["fails: wrong answer"]);
    expect(lines.some((l) => l.includes("✓ passes"))).toBe(true);
    expect(lines.some((l) => l.includes("✗ fails: wrong answer"))).toBe(true);
  });

  test("setup runs inside the sandbox and check sees the same dir", async () => {
    let setupDir = "";
    const cases: EvalCase[] = [
      {
        name: "sandboxed",
        setup: (dir) => {
          setupDir = dir;
          writeFileSync(join(dir, "fixture.json"), "{}");
        },
        check: ({ dir }) => {
          if (dir !== setupDir) return "check ran in a different dir than setup";
          return existsSync(join(dir, "fixture.json")) ? null : "fixture missing";
        },
      },
    ];

    const outcome = await runEvalSuite({
      flowPath: "fake.md",
      cases,
      runFlow: okRunner,
      log: () => {},
      noLedger: true,
    });
    expect(outcome.pass).toBe(1);
    // Sandbox is cleaned up afterwards.
    expect(existsSync(setupDir)).toBe(false);
  });

  test("--filter selects cases by substring", async () => {
    const cases: EvalCase[] = [
      { name: "alpha one", check: () => null },
      { name: "beta two", check: () => "should not run" },
    ];

    const outcome = await runEvalSuite({
      flowPath: "fake.md",
      cases,
      runFlow: okRunner,
      filter: "alpha",
      log: () => {},
      noLedger: true,
    });
    expect(outcome.total).toBe(1);
    expect(outcome.fail).toBe(0);
  });

  test("a throwing check counts as a failure, not a crash", async () => {
    const cases: EvalCase[] = [
      {
        name: "explodes",
        check: () => {
          throw new Error("boom");
        },
      },
    ];

    const outcome = await runEvalSuite({
      flowPath: "fake.md",
      cases,
      runFlow: okRunner,
      log: () => {},
      noLedger: true,
    });
    expect(outcome.fail).toBe(1);
    expect(outcome.failures[0]).toContain("boom");
  });

  test("the runner receives prompt, stdin, and a sandbox cwd", async () => {
    let seen: Parameters<FlowRunner>[0] | undefined;
    const spyRunner: FlowRunner = async (spec) => {
      seen = spec;
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await runEvalSuite({
      flowPath: "fake.md",
      cases: [{ name: "spy", prompt: "top 3", stdin: "{}", check: () => null }],
      runFlow: spyRunner,
      log: () => {},
      noLedger: true,
    });

    expect(seen?.prompt).toBe("top 3");
    expect(seen?.stdin).toBe("{}");
    expect(seen?.cwd).toContain("mdflow-eval-");
  });
});

describe("trust ledger", () => {
  test("full clean run stamps lastCleanAt; later failure preserves it", () => {
    const ledger = join(tempDir, "eval-results.json");

    recordEvalResult(
      "flows/jq.eval.ts",
      { flow: "flows/jq.md", pass: 2, fail: 0, total: 2, lastRunAt: "2026-07-04T00:00:00Z", full: true },
      ledger
    );
    let entry = readEvalLedger(ledger)["flows/jq.eval.ts"]!;
    expect(entry.lastCleanAt).toBe("2026-07-04T00:00:00Z");

    recordEvalResult(
      "flows/jq.eval.ts",
      { flow: "flows/jq.md", pass: 1, fail: 1, total: 2, lastRunAt: "2026-07-05T00:00:00Z", full: true },
      ledger
    );
    entry = readEvalLedger(ledger)["flows/jq.eval.ts"]!;
    expect(entry.fail).toBe(1);
    expect(entry.lastCleanAt).toBe("2026-07-04T00:00:00Z");
  });

  test("filtered runs never stamp lastCleanAt", () => {
    const ledger = join(tempDir, "eval-results.json");
    recordEvalResult(
      "flows/x.eval.ts",
      { flow: "flows/x.md", pass: 1, fail: 0, total: 1, lastRunAt: "2026-07-04T00:00:00Z", full: false },
      ledger
    );
    expect(readEvalLedger(ledger)["flows/x.eval.ts"]!.lastCleanAt).toBeUndefined();
  });

  test("ledger write goes through runEvalSuite with suiteKey and ledgerPath", async () => {
    const ledger = join(tempDir, "suite-ledger.json");
    await runEvalSuite({
      flowPath: "fake.md",
      cases: [{ name: "ok", check: () => null }],
      runFlow: okRunner,
      log: () => {},
      suiteKey: "suites/fake.eval.ts",
      ledgerPath: ledger,
    });

    const entry = readEvalLedger(ledger)["suites/fake.eval.ts"]!;
    expect(entry.pass).toBe(1);
    expect(entry.full).toBe(true);
    expect(entry.lastCleanAt).toBeDefined();
  });
});
