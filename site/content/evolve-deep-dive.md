---
title: mdflow Evolve — change with proof
description: How feedback becomes a private prompt proposal with content-bound verification, capability checks, explicit review, atomic apply, and rollback.
---

# Agents that can change — through proof

`mdflow v4 · proposal-first evolution`

Evolve turns a reported problem into a reviewable prompt proposal. It does not
let a timing signal rewrite a live agent, and it does not call an equal green
score a fix.

> `md feedback` → reviewed eval → `md evolve plan` → private proposal → exact
> verification → review → explicit apply or reject.

The moat is not self-editing. It is a provider-neutral change protocol where
evidence, capabilities, cost, proof, consent, lineage, and rollback are all
inspectable.

## The contract

Evolve makes ten promises:

1. The resolved maintainer, maximum flow invocations, and write surface appear
   before paid work starts.
2. Quick reruns and metadata-only failures cannot authorize source mutation.
3. A proposal cannot silently add command, network, provider, or file access.
4. Current and proposal verification never use the canonical flow as a test
   fixture.
5. Proof is bound to exact content and execution configuration.
6. Apply and rollback are atomic, locked, hash-guarded transactions.
7. Rejection, timeout, and infrastructure failure leave evidence open.
8. “Verified improvement” requires feedback-specific red/green proof.
9. Decisions have durable states, reason codes, artifacts, and event journals.
10. Automatic policy creates proposals only. Source changes require review and
    an explicit apply command.

## One problem, one stable ID

```console
$ md feedback flows/review.md "missed the renamed-file regression"
Feedback fb_01J… saved for flows/review.md

Status: saved, not yet proved
Next: md evolve plan flows/review.md
```

Feedback is private, bounded, and durable. Each item moves through `open →
targeted → resolved | dismissed`; it is never consumed by a wall-clock
watermark. `md feedback list`, `show`, `dismiss`, and `reopen` make that state
visible; `md feedback forget <id> --yes` explicitly removes one item and its
status history from private storage.

`md evolve prune --days 30` removes older unapplied attempts and completed job
logs after confirmation, while retaining applied rollback lineage.

A quick rerun is ambiguous: maybe the user changed input, compared providers,
or pressed Enter twice. When enabled, mdflow records it only as a low-confidence
observation and asks for explicit feedback. It does not spend or mutate.

## Distill drafts a test, not truth

```console
$ md feedback distill fb_01J…
Draft eval case: ~/.mdflow/evolution/drafts/fb_01J….eval-case.ts

This is an untrusted, deliberately failing draft.
Review its assertion before copying it into the suite.
```

Eval files are executable TypeScript. Generated code cannot quietly become the
policy that judges future agents, so the draft lives outside the repository and
fails on purpose until a human defines an observable assertion. A reviewed case
links back with `evidence: ["fb_01J…"]`.

## Plan before spending

```console
$ md evolve plan flows/review.md
proposal ready to plan: suite and actionable feedback are present
cost: at most 7 flow invocations: 1 proposal + 3 current + 3 proposal
writes: private evolution artifact only; source remains unchanged
maintainer: claude/opus (isolated)
```

`plan` is free. It statically inspects the suite without importing executable
top-level code, and the arithmetic includes repeated eval trials. Non-interactive
paid work refuses without `--yes`; interactive confirmation defaults to No.
Machine consumers can use one `--json` result or streaming `--events` NDJSON.

The policy can cap invocations, proposals per day, and cooldown. `propose` mode
prints this plan and queues private background work after explicit actionable
feedback. Legacy `evolve: auto` maps to proposal-only behavior. There is no
unattended apply.

## The live flow never becomes the fixture

Each proposal gets a private `evr_...` receipt directory containing its plan,
evidence membership, immutable current and proposal files, prompt/capability
diffs, current/proposal results, decision, and append-only events.

Current and proposal run from separate repository snapshots. Tracked and
untracked non-ignored files are copied off-path; symlinks that escape the
repository are refused. No `.pending.md`, scratch gate ledger, or half-tested
candidate appears beside a runnable flow.

These workspaces are isolation fixtures, not host sandboxes. Eval modules and
engines still have whatever filesystem, network, credential, and process access
the current user grants them. Timed-out process groups receive TERM and then
KILL, but users must still review executable suites.

## Capability changes are a separate axis

Freezing YAML is not enough: a prompt body can contain inline commands,
executable fences, remote URLs, context providers, globs, and file imports.
Evolve computes a capability manifest before candidate execution. New
capabilities park the proposal as `capability_rejected` unless a policy
explicitly permits the private experiment; they can never produce an automatic
source edit.

## Proof is a receipt, not a timestamp

A content receipt hashes:

- the flow and execution-relevant imported files/globs;
- the eval suite and its local module graph;
- merged project/global configuration;
- resolved engine and model;
- mdflow version; and
- case definitions, evidence links, repetitions, and quorum.

Change any relevant input and the old receipt becomes stale. Moving a checkout
does not invalidate equivalent content merely because an absolute path changed.
Automatic comparative proof accepts either a clean current receipt or a stable
receipt whose failures are all linked to the targeted feedback; unrelated
current failures block the run.

Unknown nonzero exits fail unless a case explicitly sets `allowNonZero: true`.
Recognized provider, authentication, environment, cancellation, and timeout
failures are inconclusive. Repeated stochastic cases report every trial; mixed
pass/fail results are flaky and cannot mint clean proof, even when their numeric
quorum passes.

## Four honest outcomes

| Outcome | What it means |
| --- | --- |
| **Verified improvement** | A feedback-linked case failed on current, passed on proposal, and every proposal guardrail passed without flake. |
| **Regression-safe proposal** | Guardrails passed, but no case proved the reported problem red/green. Human review only. |
| **Rejected** | The proposal regressed declared behavior. Evidence remains open. |
| **Inconclusive** | Timeout, infrastructure uncertainty, interruption, or flake prevented a trustworthy result. Evidence remains open. |

Equal scores can justify a reviewable proposal. They cannot justify the word
“fixed.”

## Review, apply, recover

```console
$ md evolve show evr_01J…
Status: verified_improvement
Capabilities: no additions
Invocations: 7/7

diff --git current.md proposal.md
…

$ md evolve apply evr_01J…
Status: applied

$ md evolve rollback evr_01J…
Status: rolled_back
```

`show` exposes the decision, capability delta, planned/actual invocations, and
prompt diff. Apply takes a per-flow lock and compare-and-swaps against the exact
base hash; a human edit made after proposal creation wins. Persistence uses a
same-directory temporary file, fsync, and rename. Rollback is guarded against
overwriting newer work, and interrupted transaction states recover from content
hashes rather than backup filenames.

## Policy without magic

```yaml
evolve:
  mode: propose             # off | observe | suggest | propose | apply
  triggers: [explicit-feedback, classified-failure]
  maintainer:
    engine: claude
    model: opus
    isolated: true
    timeout-ms: 180000
  budget:
    max-invocations: 9
    max-per-day: 2
    cooldown-ms: 86400000
  gate:
    require-feedback-eval: true
    allow-capability-delta: false
    repetitions: 1
  apply: review
```

- `off`: no automatic observation or work.
- `observe`: retain enabled evidence only.
- `suggest`: surface the next free action without spending.
- `propose`: queue bounded private proposal work; never edit source.
- `apply`: reserved for a future earned automation tier; today it remains
  proposal-only for automatic handling.

Use `--no-evolve` or `MDFLOW_EVOLVE=off` as an immediate escape hatch. Workflow
runs keep the same feedback affordances, but proposal generation explicitly
refuses until step-level attribution can identify the responsible agent node.
`md evolve prune --days 30 --yes` removes eligible old private proposals and
completed job logs while retaining applied lineage.

## The creed

> If a guardrail is not covered by an eval, it is a wish.

> If feedback is not covered by a red/green case, it is not a proved fix.

> Agents may change—but only through evidence, capability accounting, exact
> receipts, explicit consent, atomic application, and rollback.

---

[→ mdflow.dev](https://mdflow.dev) · [→ GitHub](https://github.com/johnlindquist/mdflow) · [→ normative Evolve docs](https://github.com/johnlindquist/mdflow/blob/main/docs/evolve.md)
