#!/usr/bin/env bun

const started = performance.now();
const cli = await import("../../src/cli.ts");
const afterCliImport = performance.now();
const files = await cli.findAgentFiles();
const afterDiscovery = performance.now();
await import("../../src/workbench.ts");
const afterWorkbenchImport = performance.now();
const statusModule = await import("../../src/workbench-status.ts");
const afterStatusImport = performance.now();
const statuses = await statusModule.buildWorkbenchStatusMap(files);
const afterStatuses = performance.now();

const sources = Object.fromEntries(
  [...new Set(files.map((file) => file.source))]
    .sort()
    .map((source) => [source, files.filter((file) => file.source === source).length]),
);

console.log(JSON.stringify({
  cliImportMs: afterCliImport - started,
  discoveryMs: afterDiscovery - afterCliImport,
  workbenchImportMs: afterWorkbenchImport - afterDiscovery,
  statusImportMs: afterStatusImport - afterWorkbenchImport,
  buildStatusesMs: afterStatuses - afterStatusImport,
  totalMs: afterStatuses - started,
  pathDirs: (process.env.PATH ?? "").split(":").filter(Boolean).length,
  fileCount: files.length,
  statusCount: Object.keys(statuses).length,
  sources,
}));
