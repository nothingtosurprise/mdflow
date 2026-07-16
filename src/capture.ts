/**
 * `md capture` — FREE. Prints the conversation-capture guide to stdout.
 *
 * Meant to be run from INSIDE an agent session (Claude Code, Codex, ...):
 * the agent executes `md capture`, reads the printed guide, and follows it to
 * distill the current conversation into a reusable flow — interviewing the
 * user about what to keep and converting commands the user ran during the
 * session into !`cmd` context injections and `@` file imports.
 *
 * Like `md init --print-guide`, the guide is assembled with plain string
 * replacement on purpose — no Liquid, no import expansion — and printing it
 * never launches an engine, never reads the project, and never writes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mdflowVersion } from "./compat";

const ASSETS_DIR = join(import.meta.dir, "..", "assets", "capture");

/** Assemble the capture guide: bundled guide with placeholders filled. */
export function buildCaptureGuide(): string {
	const guide = readFileSync(join(ASSETS_DIR, "guide.md"), "utf-8");
	return guide.replaceAll("__MDFLOW_VERSION__", mdflowVersion()).trimEnd();
}
