/**
 * `md capture` — the printed guide an in-session agent follows to capture
 * the current conversation as a flow. The command is FREE: it prints the
 * assembled guide and does nothing else, so these tests pin the assembly
 * (placeholders filled) and the content contract the guide must teach —
 * above all, converting session commands into !`cmd` context injections.
 */

import { describe, expect, it, spyOn } from "bun:test";
import { buildCaptureGuide } from "./capture";
import { mdflowVersion } from "./compat";
import { CliRunner } from "./cli-runner";
import { createTestEnvironment } from "./system-environment";

describe("buildCaptureGuide", () => {
	const guide = buildCaptureGuide();

	it("fills the version placeholder", () => {
		expect(guide).toContain(`mdflow v${mdflowVersion()}`);
		expect(guide).not.toContain("__MDFLOW_VERSION__");
	});

	it("teaches context injection from the conversation's commands", () => {
		// The capture skill this command exists for: commands the user ran in
		// the session become run-time !`cmd` injections, not pasted output.
		expect(guide).toContain("Context injection");
		expect(guide).toContain("!`git diff --cached`");
		expect(guide).toMatch(/inject(ing)? the command/i);
		expect(guide).toContain("candidate for injection");
	});

	it("teaches @ imports as the file-content counterpart", () => {
		expect(guide).toContain("@./path/file.ts");
		expect(guide).toContain("@./src/**/*.ts");
		expect(guide).toContain("`@` imports");
	});

	it("directs the agent to interview the user before writing", () => {
		expect(guide).toContain("Interview the user");
		expect(guide).toContain("accept or decline");
		expect(guide).toMatch(/Do not write any file before the user approves/);
	});

	it("permits only FREE verification invocations", () => {
		expect(guide).toContain("md explain <flow>");
		expect(guide).toContain("--_dry-run");
		expect(guide).toContain("NEVER do a real run");
	});

	it("is deterministic", () => {
		expect(buildCaptureGuide()).toBe(guide);
	});
});

describe("md capture (CLI)", () => {
	it("prints the guide to stdout and exits 0", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const runner = new CliRunner({
				env: createTestEnvironment(),
				isStdinTTY: false,
				isStdoutTTY: false,
			});
			const result = await runner.run(["node", "md", "capture"]);
			expect(result.exitCode).toBe(0);
			const stdout = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(stdout).toContain("Context injection");
			expect(stdout).toContain("!`git diff --cached`");
		} finally {
			logSpy.mockRestore();
		}
	});
});
