# mdflow v3 — flows that learn

Status: historical v3 design record. The current package is v4; use
[`docs/public-api.md`](public-api.md) and the root README for the current
contract. Updated 2026-07-07.

v3 absorbs an earlier single-file-agent prototype (now retired; its durable
ideas live here under mdflow's own vocabulary). The pitch:

mdflow v2: your markdown files are executable AI agents.
mdflow v3: **your flows learn from use.**

The creed, carried over verbatim: **"If a guardrail isn't covered by an
eval, it's a wish."**

## Landed on the v3 branch

### Engine resolution ladder (`engine:` replaces `tool:`)

The engine is environment, not filename ceremony. Most explicit first:

1. `--engine` CLI flag (deprecated aliases: `--_command`/`-_c`, `--tool`)
2. `MDFLOW_ENGINE` env var — "run everything on X" override
3. Filename suffix (`task.claude.md`) — still works, never required
4. Frontmatter `engine:` (deprecated aliases: `tool:`, `_tool:` — they warn)
5. Config `engine:` — project config beats `~/.mdflow/config.yaml`
6. Built-in default: **pi**

Implicit resolution prints a dim `file.md → pi (engine: default)` line on
stderr — defaults are inspectable, never magic. A file with **no frontmatter
and no explicit engine is a document**: `md README.md` prints it instead of
executing it. Frontmatter is what marks a file as a flow.

### Engines

New adapters: **pi** (default), **cursor-agent**, and **agy** (Google
Antigravity, successor to the sunset gemini CLI — not flag-compatible with
gemini; OAuth-only auth). The gemini adapter remains for Code Assist
Standard/Enterprise orgs that keep the old CLI.

pi disables extension/skill/prompt-template/context-file discovery and session
persistence by default. This isolates ambient engine context; it does not
sandbox the host filesystem, network, environment, credentials, or commands,
so portability still depends on declared capabilities and fixtures. Re-enable
a layer per flow (`no-context-files: false`).

pi also gets a **subscription auth bridge**: its `openai-codex` provider
shares the Codex CLI's OAuth client, so mdflow maintains a bridged agent dir
at `~/.mdflow/pi-agent` (freshest-token merge; never writes to the user's
real credential files) and points every pi spawn at it via
`PI_CODING_AGENT_DIR`. Fresh Codex CLI login = working default engine, zero
setup. Adapters can contribute spawn-time env vars via the new optional
`ToolAdapter.prepareEnv()` hook.

### Isolation (`_isolated`) and system prompt (`_system-prompt`)

Engine context isolation is the default where supported: flows run with
ambient skills, MCP servers, memory/context files, plugins, and session
persistence stripped, using adapter-verified flags layered between config
defaults and frontmatter. Whatever a flow needs it references explicitly
(`mcp-config:`, `plugin-dir:`, `add-dir:`, extension paths). This is not a
host security sandbox. Opt out per flow (`_isolated: false`), per
invocation (`--_isolated false`), or per machine
(`commands.<engine>._isolated: false` in config); an isolated flow can also
re-enable a single layer (`safe-mode: false`). claude gets `--safe-mode
--no-session-persistence`, codex `--ignore-user-config --ephemeral -c
project_doc_max_bytes=0`, gemini `--extensions none`, copilot
`--no-custom-instructions --disable-builtin-mcps`, opencode `--pure`;
droid/cursor-agent/agy have no controls, run ambient, and warn only when a
flow explicitly sets `_isolated: true`. Every flag was verified against the
engine's own `--help` or shipped source (claude's `--bare` is deliberately
avoided: it locks auth to `ANTHROPIC_API_KEY`).

`_system-prompt` (replace) and `_append-system-prompt` (append; string or
list) make the system prompt part of the flow file. Translations: claude/pi
native flags; codex `-c model_instructions_file=<temp file>` /
`-c developer_instructions=…`; gemini `GEMINI_SYSTEM_MD=<temp file>`
(replace only). Engines with no mechanism fail the run instead of silently
dropping the prompt. `md explain` shows both resolutions for free.

### Evals (`md eval`)

`md eval flows/jq.md` runs the colocated suite `flows/jq.eval.ts`
(`export default` an `EvalCase[]`): each case gets an isolated temp workspace
(`setup` fixtures → real flow run → `check` on stdout AND the filesystem).
Per-case cost is printed before anything is spent. Results land in the trust
ledger (`~/.mdflow/eval-results.json`, `MDFLOW_EVAL_RESULTS` override); a
full clean run stamps `lastCleanAt`. Eval runs redirect `MDFLOW_RUNS_FILE`
into the sandbox — synthetic runs never enter the telemetry corpus.

### Evolve (`md evolve`)

`md complain flows/jq.md "output was wrong"` records evidence
(`~/.mdflow/complaints.jsonl`, override `MDFLOW_COMPLAINTS_FILE`); non-zero
exits in the runs corpus count too. `md evolve flows/jq.md` then: gathers
evidence newer than the watermark (last accepted evolution or last clean eval,
whichever is later) → refuses if there is no eval suite or no fresh evidence
(`--check` shows the decision for free) → prints cost → scores the ancestor
on its own suite (baseline) → asks a maintainer engine for a revised prompt
BODY only (frontmatter is frozen; complaints are framed as untrusted
evidence; the reply is accepted only from a fenced block with the closing
fence on its own line) → gates the candidate on the full suite. Accepted
means clean and no worse than the baseline: regression is a printed measurement
(`ancestor 0/1 → candidate 1/1`). A complaint is measured only when an eval
represents it. Failures revert byte-identical
and park the candidate at `<flow>.pending.md`. Gate runs write a scratch
ledger, never the trust ledger; acceptance ends by pointing at `git diff`.

**Auto mode.** `evolve: auto` in frontmatter opts a flow into the full loop:
after each successful run, a re-run within `QUICK_RERUN_WINDOW_MS` (2 min) is
recorded as an implicit complaint ("the user re-ran because the output wasn't
right"), and evolution fires automatically on fresh evidence — gated on the
trust ledger's `lastCleanAt`, the purpose-built proof-of-clean-suite marker:
machine diffs never auto-apply to a suite that has not passed clean at least
once. Eval-sandbox runs (`MDFLOW_EVAL_RUN`) neither record implicit
complaints nor trigger the hook. Watermarks are per-evidence-kind: complaints
are consumed only by evolution itself (a clean eval can't see a verbosity
complaint), while rough runs are consumed by evolution or a later clean full
eval. An accepted evolution records the passing gate run to the trust ledger
— the applied content is what just passed. Crash safety: the original is
parked at `<flow>.md.evolve-backup` before mutation and auto-restored on the
next evolve if a run died mid-gate.

The verification harness (`src/evolve.test.ts`) proves all three claims
deterministically with stub engines: it works (failing ancestor → applied
passing candidate), it is beneficial (measured baseline delta, bad candidates
revert), and it never fires when it shouldn't (no suite, no evidence,
synthetic eval-sandbox runs, stale pre-watermark evidence → zero maintainer
calls, zero eval turns).

## Still to come

- **Distill**: recorded real runs → eval cases (good runs lock behavior in,
  bad runs become tests that fail on purpose).
- **Tournament**: competing candidate revisions scored against the suite
  plus probe replays of real prompts.
- **Routing**: `md route "query"` keyword-summons flows that declare
  `route:` frontmatter.
- Portable frontmatter vocabulary hardening (validated keys + per-engine
  passthrough blocks) and structured event streams per engine.

## Invariants (port these into every learning feature)

1. **The learning corpus is real usage only.** Eval runs, probes, and
   tournament candidates opt out of recording — always.
2. **Everything is gated on proof.** Diffs apply only if the eval suite
   passes; failures revert; candidate runs never write the real trust ledger.
3. **Session content is untrusted evidence.** Prompts sent to
   maintainer/judge models must keep saying so.
4. **Model output is hostile input.** Fenced-block parsers require closing
   fences on their own line; diffs apply with `git apply --recount`.
5. **Never commit or push for the user.** Accept flows end by pointing at
   `git diff`.
6. **Cost is printed before it is spent.** Any command that runs a flow,
   distills, judges, or tournaments prints its own arithmetic first.

## Release

`3.0.0` is live on the npm `latest` dist-tag. The `v3` branch continues to
publish `3.0.0-next.N` prereleases on the `next` dist-tag via
semantic-release; merges to main graduate them.
