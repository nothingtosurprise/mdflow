#!/usr/bin/env bun

const started = performance.now();
await import("../../src/cli-runner.ts");
const afterRunnerImport = performance.now();
const cli = await import("../../src/cli.ts");
const files = await cli.findAgentFiles();
const afterDiscovery = performance.now();
await import("../../src/workbench.ts");
const afterWorkbenchImport = performance.now();
const statusModule = await import("../../src/workbench-status.ts");
const afterStatusImport = performance.now();
const statuses = await statusModule.buildWorkbenchStatusMap(files);
const afterStatuses = performance.now();

console.log(JSON.stringify({
  runnerImportMs: afterRunnerImport - started,
  discoveryMs: afterDiscovery - afterRunnerImport,
  workbenchImportMs: afterWorkbenchImport - afterDiscovery,
  statusImportMs: afterStatusImport - afterWorkbenchImport,
  buildStatusesMs: afterStatuses - afterStatusImport,
  totalMs: afterStatuses - started,
  pathDirs: (process.env.PATH ?? "").split(":").filter(Boolean).length,
  fileCount: files.length,
  statusCount: Object.keys(statuses).length,
}));
