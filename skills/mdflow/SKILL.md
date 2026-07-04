---
name: mdflow
description: Create and run mdflow flows — markdown files that are executable AI agents (frontmatter + prompt body, runnable on claude, codex, pi, cursor-agent, copilot, agy and any CLI engine). Use when the user asks to "create a flow", "make a markdown agent", "add an mdflow", "wrap this prompt as a command", or wants repeatable AI tasks with evals.
---

# mdflow flows

A flow is one markdown file that runs as an AI agent: YAML frontmatter for
config, the body as the prompt. mdflow spawns the right engine CLI and passes
everything through. No project setup, no registry — a flow is just a file.

```markdown
# review.md
---
description: review staged changes
---
Review this diff for bugs. Be terse, cite file:line.

!`git diff --cached`
```

Run it: `md review.md` (or make it executable and run `./review.md` after
`md setup`). **Every run costs one engine turn** — say so before running
flows for the user.

## Step 0 — is mdflow installed? (free)

```bash
command -v md || npm i -g mdflow@next   # v3 prerelease; drop @next once 3.0 ships
```

## Engines: the resolution ladder

You usually don't pick an engine — the ladder does, most explicit first:

1. `--engine <name>` CLI flag
2. `MDFLOW_ENGINE` env var
3. Filename: `review.claude.md` (only wins if the engine actually exists)
4. Frontmatter: `engine: codex`
5. Config `engine:` — project `.mdflow.yaml` beats `~/.mdflow/config.yaml`
6. Default: **pi** (hermetic; bridges the user's Codex CLI login automatically)

Implicit choices print a dim `review.md → pi (engine: default)` line to
stderr. Engines: claude, codex, copilot, pi, cursor-agent, agy (Google
Antigravity — the gemini CLI's successor), droid, opencode, or any CLI binary.

Rules that matter when authoring:

- **Frontmatter marks a file as a flow.** No frontmatter + no explicit
  engine = mdflow prints the file as a document instead of executing it.
  Always include at least one frontmatter key (e.g. `description:`).
- Non-system frontmatter keys pass through as CLI flags to the engine
  (`model: opus` → `--model opus`). Portable keys (`model`, `temperature`,
  `max-tokens`) are translated or dropped per engine.
- Imports compose context: `@./src/**/*.ts` (globs), `@./file.ts:10-50`
  (line ranges), `` !`cmd` `` (command output), `{{ _var }}` template vars
  set via `--_var value`.
- Pipes chain flows: `md research.md | md plan.md | md implement.md`.

## Evals — every flow you create should ship one

Creed: **if a guardrail isn't covered by an eval, it's a wish.** Colocate
`<flow>.eval.ts` next to `<flow>.md`:

```ts
// review.eval.ts
import type { EvalCase } from "mdflow/src/evals";

const cases: EvalCase[] = [
  {
    name: "flags the planted bug",
    setup: (dir) => {
      // write fixtures into the sandbox the flow will run in
    },
    check: ({ stdout, dir, exitCode }) => {
      if (exitCode !== 0) return `exit ${exitCode}`;
      return /bug|issue/i.test(stdout) ? null : "review missed the planted bug";
    },
  },
];

export default cases;
```

`md eval review.md` runs each case in a hermetic temp dir and records
results in the trust ledger (`~/.mdflow/eval-results.json`). It prints the
cost (one engine turn per case) before running — get the user's go-ahead.
Write checks on invariants (files, numbers, names), not exact wording.

## Workflow for "create me a flow for X"

1. Write `<name>.md` with a `description:` frontmatter key, tight prompt
   body, and imports for whatever context the task needs. Don't pin an
   engine unless the task demands a specific one.
2. Free checks: `md <name>.md --_dry-run` shows the exact command; `md
   explain <name>.md` shows resolved config.
3. Write `<name>.eval.ts` with 1–3 behavioral cases.
4. Offer the user: `md <name>.md` (one turn) and `md eval <name>.md`
   (one turn per case).

## Migrating v2 flows

`tool: X` frontmatter → `engine: X` (old key warns). `--_command`/`--tool`
flags → `--engine`. Files named `task.<engine>.md` keep working; bare
`task.md` now runs on the resolved engine instead of erroring.
