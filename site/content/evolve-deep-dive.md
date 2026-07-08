---
title: mdflow auto-evolve — flows that improve themselves, gated on proof
description: How auto-evolution redrafts a flow's prompt from real complaints and applies the new draft only when the eval suite proves it clean and no worse than before.
source: https://tropic-hill-p35c.here.now/
---

# Flows that improve themselves — gated on proof

`mdflow v4 · evolve: auto`

**Auto-evolution** lets an mdflow flow redraft its own prompt from real complaints, and applies the new draft only when the eval suite proves it is clean and no worse than before.

> `md complain` → `md evolve` → the flow rewrites its prompt, gates it on the suite, and keeps it only if it wins.

## What mdflow is

mdflow (`md`) runs AI agents defined as markdown files — **flows**. YAML frontmatter becomes CLI flags for an engine (claude, codex, copilot, pi, …); the body is the prompt. Flows live in `./flows` and earn behavioral eval suites (`<flow>.eval.ts`, run with `md eval`). Results land in a **trust ledger**, where a full clean pass stamps `lastCleanAt`. Auto-evolution turns everyday dissatisfaction into a reversible prompt revision guarded against suite regressions.

## Five stages, evidence to outcome

Every stage is a checkpoint. Nothing downstream runs until the stage before it earns its right to.

### 1 · Evidence — real usage becomes signal

`md complain flows/x.md "too verbose"` records an explicit complaint. Non-zero-exit runs in the telemetry corpus are *rough runs*. For `evolve: auto` flows, re-running within 2 minutes records an implicit complaint — the user re-ran because the output wasn't right.

### 2 · Decision — `decideEvolve()`, a pure function that refuses

Refuses without an eval suite (*evolution is gated on proof*). Refuses without fresh evidence. In auto mode, additionally refuses unless the trust ledger has `lastCleanAt` — machine diffs never auto-apply to an unproven suite.

### 3 · Draft — redraft the body, freeze the frontmatter

One engine turn redrafts the prompt **body only** — the mutation surface is data, not code. Complaints are framed as untrusted evidence. The reply is accepted only if it holds *exactly one* fenced block, closing fence on its own line, non-empty body.

### 4 · Gate — regression is measured

The ancestor is scored on its own suite first (baseline). Then the candidate runs the same full suite. Accepted only if it is clean **and no worse than baseline**: `benefit: ancestor 0/1 → candidate 1/1`. That proves the candidate against the suite; it proves the complaint was fixed only when an eval case represents that complaint.

### 5 · Outcome — applied for review, or byte-identical revert

Accepted → applied in place; review with `git diff` (mdflow never commits). Rejected → byte-identical revert, and the candidate is parked at `<flow>.pending.md`.

## Why auto mode waits for `lastCleanAt`

Manual `md evolve` needs a suite and fresh evidence. Auto mode adds one more rung — the one that makes unattended rewrites safe.

**Machine diffs never auto-apply to an unproven suite.** `decideEvolve` in auto mode refuses unless the flow's trust-ledger entry carries `lastCleanAt` — the codebase's purpose-built proof-of-clean-suite marker, stamped only when a full `md eval` passes clean end-to-end.

Without it, there is no ground truth for "no worse than baseline" to mean anything. So the flow refuses, out loud, and tells you exactly what to do: run `md eval` to a clean pass first. An unproven suite can gate nothing.

## Watch it refuse, then earn it

Real run, `claude` as the maintainer engine. The flow refuses until the suite is proven clean, then evolves on the next ordinary run.

```console
$ md evolve flows/answer.claude.md --check --auto
no evolution: auto evolution requires a trust-ledger entry with lastCleanAt —
run `md eval` to a clean pass first. Machine diffs never auto-apply to an
unproven suite.
  complaint: way too verbose - I just want the one word

$ md eval flows/answer.claude.md
  ✓ answers green
1/1 passed
clean run recorded in trust ledger

$ md flows/answer.claude.md          # a normal run — evolution fires post-run
The team color is **GREEN**. ...
evolve: auto — evolve: 1 complaint(s), 0 rough run(s)
evolve: auto — cost: 1 maintainer turn + 1 baseline eval turn(s) + 1 candidate eval turn(s) = 3 engine turns
evolve: auto — baseline (ancestor):
evolve: auto —   ✓ answers green
evolve: auto — drafting candidate (1 maintainer turn)…
evolve: auto — gating candidate against the eval suite:
evolve: auto —   ✓ answers green
evolve: auto — benefit: ancestor 1/1 → candidate 1/1
evolve: auto — applied. Review with: git diff flows/answer.claude.md
```

Note the arithmetic on line 2 of the run: **cost is printed before it is spent**. The suite scored the ancestor at 1/1 and the candidate at 1/1 — the candidate is no worse and clean, so it wins on the strength of addressing a verbosity complaint the suite can't see.

## What one maintainer turn changed

Frontmatter frozen, body only. The rambling reasoning prompt became a direct one.

**− before (ancestor body)**

```text
Think step by step, and explain your reasoning in a few sentences before you
give the final answer. Walk through what the team color might be and why,
then conclude.
```

**+ after (applied candidate)**

```text
Answer the team color question directly and concisely. The team color is
GREEN. State that as the very first line of your reply. Do not invent
reasoning, history, or step-by-step deliberation — the answer is fixed, so
padding it with speculation only buries it.
```

The frontmatter block was preserved byte-for-byte. A drafter that tried to sneak `dangerously-skip-permissions: true` into the frontmatter could not — `replaceBody` only ever touches the prompt text.

## Each invariant, and the test that proves it

The verification harness (`src/evolve.test.ts`) drives every claim deterministically with stub engines — no real model, no flake.

- **No suite → never fires. No evidence → never fires.** `decideEvolve` is a pure function; the "must not fire" cases assert zero maintainer calls and zero eval turns.
- **Synthetic eval-sandbox runs can never become evidence.** `MDFLOW_EVAL_RUN` short-circuits the hook and `MDFLOW_RUNS_FILE` is redirected into the sandbox — the learning corpus is real usage only.
- **Accepted evolution consumes its evidence.** The evolve ledger's watermark advances on acceptance — no re-trigger loops on the same complaints.
- **Bad candidates revert byte-identical.** A candidate that scores worse (or dirty) is written back to the original bytes and parked at `<flow>.pending.md`.
- **Crash safety mid-gate.** The original is parked at `<flow>.md.evolve-backup` before mutation and auto-restored on the next evolve if a gate died mid-flight.
- **Cost printed before spent; `--check` is always free.** The turn arithmetic prints before any engine turn; non-TTY without `--yes` refuses to spend.
- **A drafter can't inject frontmatter.** Body-only mutation: `dangerously-skip-permissions: true` in a draft is discarded because frontmatter is frozen verbatim.

## Watermarks are per-evidence-kind

**A clean eval must not swallow a complaint it can't measure.**

Complaints are consumed **only by evolution itself**. A suite that checks correctness passing clean does not mean a *verbosity* complaint was addressed — so a clean `md eval` leaves complaints untouched for evolution to act on. Rough runs are different: a crash-class problem *is* resolved evidence once the full suite passes clean, so rough runs are consumed by evolution **or** a later clean full eval. This split was a real bug found during live verification, and fixed.

## The commands

| Command | What it does |
| --- | --- |
| `md complain <flow.md> "msg"` *(free)* | Record an explicit complaint as evolution evidence. |
| `md evolve <flow.md>` | Manual, consent-gated evolution. Prints cost, asks before spending turns. |
| `md evolve --check [--auto]` *(free)* | Preview the decision and evidence. No draft, no eval runs. |
| `md evolve --yes` | Non-interactive: skip the consent prompt (required off a TTY). |

## Opt in: one line of frontmatter

```yaml
---
description: review staged changes
evolve: auto
---
```

The frontmatter opt-in is the standing consent. After each successful run, a quick re-run is logged as an implicit complaint, and evolution fires on fresh evidence — still refusing without a suite, without evidence, and without `lastCleanAt`.

## The creed

> If a guardrail isn't covered by an eval, it's a wish.

> Everything is gated on proof.

> Regression is measured. Improvement becomes proof when the complaint is an eval.

---

[→ mdflow.dev](https://mdflow.dev) · [→ github.com/johnlindquist/mdflow](https://github.com/johnlindquist/mdflow)

*mdflow v4 — complaints can drive prompt revisions; frontmatter is frozen; auto-apply remains gated by the eval suite.*
