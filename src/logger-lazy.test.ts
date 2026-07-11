import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ROOT = join(import.meta.dir, "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "index.ts");
const LOGGER_URL = pathToFileURL(join(PROJECT_ROOT, "src", "logger.ts")).href;
const PINO_PATH = require.resolve("pino");

describe("session-lazy logger", () => {
  let root: string;
  let home: string;
  let flowPath: string;
  let documentPath: string;
  let preloadPath: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mdflow-logger-lazy-"));
    home = join(root, "home");
    await mkdir(home, { recursive: true });
    flowPath = join(root, "task.echo.md");
    await writeFile(
      flowPath,
      `---
_compat: 4.3.0
---
logger lazy smoke`,
    );
    documentPath = join(root, "notes.md");
    await writeFile(documentPath, "# Notes\n\nRead-only Markdown.\n");
    preloadPath = join(root, "record-pino-cache.ts");
    await writeFile(
      preloadPath,
      `Bun.plugin({
  name: "forbid-pino-import",
  setup(builder) {
    builder.onLoad({ filter: /node_modules\\/pino\\// }, () => {
      throw new Error("PINO_IMPORT_FORBIDDEN");
    });
  },
});
`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runCli(
    args: string[],
    options: { forbidPino?: boolean } = {},
  ) {
    const { forbidPino = true } = options;
    const child = Bun.spawn(
      [
        process.execPath,
        ...(forbidPino ? [`--preload=${preloadPath}`] : []),
        "run",
        CLI_PATH,
        ...args,
      ],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(root, "xdg-config"),
          XDG_CACHE_HOME: join(root, "xdg-cache"),
          MDFLOW_RUNS_FILE: join(root, "runs.jsonl"),
          MDFLOW_ENGINE: "",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          CI: "1",
          TERM: "dumb",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test("path helpers stay dependency- and filesystem-lazy until initLogger", async () => {
    const script = `
const pinoPath = ${JSON.stringify(PINO_PATH)};
const logger = await import(${JSON.stringify(LOGGER_URL)});
const before = Boolean(require.cache[pinoPath]);
logger.getLogDir();
logger.getAgentLogPath("task.echo.md");
logger.listLogDirs();
const afterHelpers = Boolean(require.cache[pinoPath]);
const logDirBeforeInit = await Bun.file(logger.getLogDir()).exists();
const facade = logger.getLogger();
let eventSeen = false;
let flushCalled = false;
facade.once("probe", () => { eventSeen = true; });
facade.emit("probe");
facade.flush(() => { flushCalled = true; });
const childBindings = facade.child({ module: "test" }).bindings();
const facadeApi = {
  eventSeen,
  flushCalled,
  childBindings,
  hasLevels: Boolean(facade.levels),
  hasVersion: typeof facade.version === "string",
  hasOnChild: typeof facade.onChild === "function",
};
logger.initLogger("task.echo.md");
const afterInit = Boolean(require.cache[pinoPath]);
logger.getLogger().flush();
console.log(JSON.stringify({ before, afterHelpers, logDirBeforeInit, facadeApi, afterInit }));
`;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, HOME: join(root, "module-home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      before: false,
      afterHelpers: false,
      logDirBeforeInit: false,
      facadeApi: {
        eventSeen: true,
        flushCalled: true,
        childBindings: { module: "test" },
        hasLevels: true,
        hasVersion: true,
        hasOnChild: true,
      },
      afterInit: true,
    });
  });

  test("non-run paths neither load Pino nor create logs", async () => {
    const cases: Array<[string, string[]]> = [
      ["help", ["help"]],
      ["logs", ["logs"]],
      ["explain", ["explain", flowPath]],
      ["dry-run", [flowPath, "--dry-run"]],
      ["document", [documentPath]],
    ];

    for (const [name, args] of cases) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("PINO_IMPORT_FORBIDDEN");
      expect(existsSync(join(home, ".mdflow", "logs"))).toBe(false);
    }

    // Control: prove the preload hook catches an eager ESM Pino import.
    const control = Bun.spawn(
      [process.execPath, `--preload=${preloadPath}`, "-e", 'await import("pino")'],
      { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [controlStderr, controlExitCode] = await Promise.all([
      new Response(control.stderr).text(),
      control.exited,
    ]);
    expect(controlExitCode).not.toBe(0);
    expect(controlStderr).toContain("PINO_IMPORT_FORBIDDEN");
  });

  test("a real run loads Pino and creates its session log", async () => {
    const result = await runCli(
      [flowPath, "--engine", "echo", "--_quiet", "--_no-menu", "--no-evolve"],
      { forbidPino: false },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("logger lazy smoke");
    const logPath = join(home, ".mdflow", "logs", "task-echo", "debug.log");
    expect(existsSync(logPath)).toBe(true);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("Session started");
    expect(log).toContain("Executing command");
  });

  test("a reused process resets a prior real logger before dry-run", async () => {
    const reuseHome = join(root, "reuse-home");
    await mkdir(reuseHome, { recursive: true });
    const runnerUrl = pathToFileURL(join(PROJECT_ROOT, "src", "cli-runner.ts")).href;
    const environmentUrl = pathToFileURL(
      join(PROJECT_ROOT, "src", "system-environment.ts"),
    ).href;
    const script = `
const [{ CliRunner }, { BunSystemEnvironment }, logger] = await Promise.all([
  import(${JSON.stringify(runnerUrl)}),
  import(${JSON.stringify(environmentUrl)}),
  import(${JSON.stringify(LOGGER_URL)}),
]);
const run = (args) => new CliRunner({
  env: new BunSystemEnvironment(),
  cwd: ${JSON.stringify(root)},
  isStdinTTY: false,
  isStdoutTTY: false,
}).run(["bun", "md", ...args]);
await run([${JSON.stringify(flowPath)}, "--engine", "echo", "--_quiet", "--_no-menu", "--no-evolve"]);
logger.getLogger().flush();
await Bun.sleep(25);
const logPath = logger.getAgentLogPath(${JSON.stringify(flowPath)});
const before = await Bun.file(logPath).text();
await run([${JSON.stringify(flowPath)}, "--engine", "echo", "--dry-run", "--_quiet"]);
logger.getLogger().flush();
await Bun.sleep(25);
const after = await Bun.file(logPath).text();
console.log("LOGGER_REUSE_RESULT=" + JSON.stringify({
  beforeBytes: Buffer.byteLength(before),
  afterBytes: Buffer.byteLength(after),
  same: before === after,
}));
`;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        HOME: reuseHome,
        MDFLOW_ENGINE: "",
        MDFLOW_RUNS_FILE: join(root, "reuse-runs.jsonl"),
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        CI: "1",
        TERM: "dumb",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const resultLine = stdout
      .split("\n")
      .find((line) => line.startsWith("LOGGER_REUSE_RESULT="));

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Agent failed");
    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!.slice("LOGGER_REUSE_RESULT=".length));
    expect(result.beforeBytes).toBeGreaterThan(0);
    expect(result.afterBytes).toBe(result.beforeBytes);
    expect(result.same).toBe(true);
  });
});
