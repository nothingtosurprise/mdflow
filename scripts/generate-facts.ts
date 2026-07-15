/**
 * generate-facts.ts — single source of truth for the factual copy shared by
 * the CLI docs and the website (site/src/facts.json).
 *
 * Derivations:
 * - engines + default engine: the live adapter registry (src/adapters) and
 *   DEFAULT_ENGINE (src/command.ts)
 * - subcommand names: scanned from src/cli-runner.ts (`subcommand === "x"`),
 *   so a new subcommand without a description entry here FAILS the build
 * - version: package.json
 *
 * Usage:
 *   bun run scripts/generate-facts.ts          # write site/src/facts.json
 *   bun run scripts/generate-facts.ts --check  # exit 1 if the file is stale
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { getRegisteredAdapters } from "../src/adapters";
import { DEFAULT_ENGINE } from "../src/command";
import { agentContractFacts, MANAGEMENT_COMMANDS } from "../src/agent-contract";

const ROOT = join(import.meta.dir, "..");
const FACTS_PATH = join(ROOT, "site", "src", "facts.json");

// --- version -----------------------------------------------------------
// Only the base version is embedded: semantic-release bumps the prerelease
// number on every release commit, and the site badge shouldn't churn (or
// fail facts:check) each time.
let packageVersion: unknown;
try {
	packageVersion = JSON.parse(
		readFileSync(join(ROOT, "package.json"), "utf-8"),
	).version;
} catch (error) {
	throw new Error(
		`generate-facts: cannot read package version: ${error instanceof Error ? error.message : String(error)}`,
	);
}
if (typeof packageVersion !== "string")
	throw new Error("generate-facts: package.json has no string version");
const versionBase = packageVersion.split("-")[0]; // 3.0.0-next.4 → 3.0.0

// --- engines -----------------------------------------------------------
const ENGINE_LABELS: Record<string, string> = {
	agy: "agy (Antigravity)",
};
const engines = getRegisteredAdapters();
const enginesLabel = engines.map((e) => ENGINE_LABELS[e] ?? e).join(", ");

// --- subcommands (names derived from cli-runner.ts) ---------------------
const cliRunnerSource = readFileSync(
	join(ROOT, "src", "cli-runner.ts"),
	"utf-8",
);
const discovered = new Set<string>();
for (const match of cliRunnerSource.matchAll(/subcommand === "([a-z-]+)"/g)) {
	discovered.add(match[1]!);
}
discovered.add("help"); // handled as a flag in src/cli.ts

/** Display order + copy. The agent contract is the canonical owner. */
const commandNames = new Set<string>(
	MANAGEMENT_COMMANDS.map((command) => command.name),
);
const undocumented = [...discovered].filter((name) => !commandNames.has(name));
if (undocumented.length > 0) {
	console.error(
		`generate-facts: subcommand(s) handled in cli-runner.ts but missing from MANAGEMENT_COMMANDS: ${undocumented.join(", ")}`,
	);
	process.exit(1);
}
const stale = MANAGEMENT_COMMANDS.map((command) => command.name).filter(
	(name) => !discovered.has(name),
);
if (stale.length > 0) {
	console.error(
		`generate-facts: MANAGEMENT_COMMANDS documents subcommand(s) no longer handled in cli-runner.ts: ${stale.join(", ")}`,
	);
	process.exit(1);
}
const commands = MANAGEMENT_COMMANDS.map(({ name, usage, summary }) => ({
	name,
	usage,
	description: summary,
}));
const contract = agentContractFacts();

const agentPrompts = {
	setup: `Set up and tailor this repository's mdflow roster safely:\n\n1. Run \`command -v md || npm i -g mdflow\`.\n2. Run \`md doctor --json\` and branch on its stable diagnostic codes and effect-labelled next actions.\n3. Preview deterministic setup, then run \`npx mdflow init --yes\`; do not launch the guided ENGINE setup unless I separately approve it.\n4. Run \`md doctor --json\` again. Preserve user-authored text in flows/README.md and keep only its managed block current with \`md roster sync\`.\n5. Tailor flows and their evals to this repository. Suite presence is not verification: init may copy real catalog suites, while md create emits fail-closed drafts.\n6. For a waiting interactive specialist, put identity in \`_system-prompt\`, stable rules in \`_append-system-prompt\`, declare \`_task: ""\`, and make the body exactly \`{{ _task }}\`; reject any \`User task:\` wrapper or empty/placeholder positional prompt.\n7. Use \`md explain <flow.md> --json\` and \`md eval <flow.md> --plan\` before asking separately for a real flow run or eval run.\n8. Treat .eval.ts and .hooks.ts as executable local code. Engine isolation is not a host sandbox. Registry install adds one flow, not trusted sidecars.`,
	evals: `Improve the proof for every project flow without spending an engine invocation yet:\n\n1. Start with \`md doctor --json\`; use its eval diagnostic codes instead of inferring proof from sibling-file presence.\n2. Review each executable .eval.ts sidecar. Replace fail-closed draft cases with 1–3 behavioral cases that check invariants, not exact prose.\n3. Run \`md eval <flow.md> --plan\` and report the exact planned invocation count including repetitions. Static planning must not import suite code.\n4. Do not run an eval until I separately approve that ENGINE operation; approval to run the flow is not eval approval.\n5. Link reproduced failures to durable feedback with evidence: ["fb_..."]. Only a current fingerprint-bound full all-pass receipt is Verified.`,
	migrate: `Migrate legacy mdflow files conservatively:\n\n1. Run \`md doctor --json\` first. Move appropriate loose agents into ./flows and use \`md roster sync\` so user-authored README text is preserved.\n2. Change tool:/_tool: to engine: and --_command/--tool to --engine.\n3. Do not mass-rename Gemini flows: gemini remains valid for Code Assist Standard/Enterprise; use agy only when the user's environment requires it.\n4. For each waiting interactive specialist, put identity in \`_system-prompt\`, stable rules in \`_append-system-prompt\`, declare \`_task: ""\`, and make the body exactly \`{{ _task }}\`; remove \`User task:\` wrappers and require no positional prompt.\n5. Inspect each result with \`md explain <flow.md> --json\` and free eval plans. Never infer consent for a real flow run, eval run, proposal, or source apply from another operation.`,
};

// --- static-but-centralized facts ---------------------------------------
const ladder = [
	{ rung: "--engine flag", note: "deprecated aliases: --_command/-_c, --tool" },
	{ rung: "MDFLOW_ENGINE env var", note: "" },
	{ rung: "filename (task.claude.md)", note: "must name a real engine" },
	{
		rung: "frontmatter engine:",
		note: "deprecated aliases: tool:/_tool: (they warn)",
	},
	{
		rung: "config engine:",
		note: "project config beats ~/.mdflow/config.yaml",
	},
	{
		rung: `default: ${DEFAULT_ENGINE}`,
		note: "implicit picks are announced on stderr",
	},
];

const mdFlags = [
	{ flag: "--engine", description: "specify the engine to run" },
	{
		flag: "--_dry-run",
		description: "preview without executing (--dry-run is an alias)",
	},
	{
		flag: "--_hooks",
		description: "override or disable the flow's hooks file",
	},
	{ flag: "--_edit", description: "edit prompt in $EDITOR" },
	{ flag: "--_context", description: "show context tree" },
	{ flag: "--raw", description: "raw output (for piping)" },
	{ flag: "--json", description: "single JSON result object" },
	{
		flag: "--no-evolve",
		description: "disable post-run evolution handling for this run",
	},
];

const facts = {
	$generated: "by scripts/generate-facts.ts — DO NOT EDIT; run `bun run facts`",
	versionBase,
	defaultEngine: DEFAULT_ENGINE,
	engines,
	enginesLabel,
	// The headline command. Bare `npx mdflow` offers first-run setup when a
	// project has no flows and opens the Workbench once a roster exists.
	install: "npx mdflow",
	repo: "https://github.com/johnlindquist/mdflow",
	ladder,
	commands,
	contract,
	agentPrompts,
	mdFlags,
};

// --- write / check -------------------------------------------------------
const output = JSON.stringify(facts, null, 2) + "\n";
const checkMode = process.argv.includes("--check");

if (checkMode) {
	const current = existsSync(FACTS_PATH)
		? readFileSync(FACTS_PATH, "utf-8")
		: "";
	if (current !== output) {
		console.error(
			"generate-facts: site/src/facts.json is stale. Run `bun run facts` and commit the result.",
		);
		process.exit(1);
	}
	console.log("generate-facts: site/src/facts.json is up to date.");
} else {
	mkdirSync(dirname(FACTS_PATH), { recursive: true });
	writeFileSync(FACTS_PATH, output);
	console.log(`generate-facts: wrote ${FACTS_PATH}`);
}
