# Claude Code hooks empirical probe

Pinned binary for every finding in this report:

- `command -v claude` -> `/Users/johnlindquist/.local/bin/claude`
- `claude --version` -> `2.1.207 (Claude Code)`
- Native target -> `/Users/johnlindquist/.local/share/claude/versions/2.1.207`
- Native SHA-256 -> `1397a062c6889675055e3314dd956376ac51262a7734ad9e819c26975d71547a`
- `claude doctor` build commit -> `bc512d563325`
- Probe date: 2026-07-10 (America/Denver)
- Probe working directory: `/private/tmp/claude-501/-Users-johnlindquist-dev-mdflow/0f13f75c-ef37-4a85-bd8c-73fe70abeeed/scratchpad/claude-probe/`

All verdicts below are pinned to Claude Code 2.1.207. Generated test settings and raw artifacts are under `claude-probe/`. The probe did not deliberately edit or copy real settings, hooks, or credentials, but the CLI itself caused out-of-bound state writes disclosed below.

Raw installed-binary receipts are `runs/binary-version/stdout.bin` and `runs/binary-help/stdout.bin`. The latter directly documents `--settings <file-or-json>`, `--setting-sources <sources>` with `user, project, local`, `--safe-mode` disabling hooks while admin-managed policy still applies, `--no-session-persistence` as print-only, and `-p` skipping workspace trust while silently ignoring invalid settings files. Runtime behavior below independently tests the release-critical claims.

> **Constraint-breach disclosure:** final log audit showed that authenticated `claude -p --no-session-persistence` runs atomically rewrote the inherited real state file `/Users/johnlindquist/.claude-third/.claude.json` (for example, `runs/q5-all-events-byteproof/debug.log` records the temp write/rename). Bash runs also created and then cleaned up transient shell snapshots under that real config root. This violated the requested no-write boundary even though the probe never directly edited those files. No rollback was attempted because there was no pre-probe baseline and other Claude sessions were active. This also proves that `--no-session-persistence` is not a general “do not write config state” flag.

## Q1 — CHANNEL

**VERDICT (2.1.207): YES for both forms.** `claude -p --settings '<inline-json>'` and `claude -p --settings <file>` both loaded and ran an injected `UserPromptSubmit` command hook. The tested settings shape is exactly `hooks -> EventName -> [{matcher,hooks:[{type:"command",command,timeout}]}]`.

Evidence:

- File case: `q1-file-settings.json`; run result `runs/q1-file/result.json`; captured stdin `runs/q1-file/events.ndjson`. Exit was `0`; stdout was the hook-block message; the event payload had `hook_event_name: "UserPromptSubmit"`.
- Inline case: the same JSON compacted with `jq -c` and passed as one quoted argv value; `runs/q1-inline/result.json` and `runs/q1-inline/events.ndjson` show the same result.
- The block happened before a model response. In both cases stdout was:

  ```text
  UserPromptSubmit operation blocked by hook:
  [bun .../record-hook.mjs exit2]: probe hook exit 2 stderr


  Original prompt: Reply with the word ok
  ```

- An unknown event key, `DefinitelyNotAHook`, was added beside the valid `UserPromptSubmit` key in `q1-invalid-event-settings.json`. The valid hook still ran and blocked (`runs/q1-invalid-event-v2/result.json`). Normal `-p` stdout/stderr and hook debug contained no invalid-event diagnostic, so the unknown entry was silently ignored without invalidating its sibling.
- A separate read-only `claude doctor` run against the invalid project fixture reported `Unknown hook event "DefinitelyNotAHook" was ignored` and emitted the pinned binary's full accepted-event registry (`runs/q1-doctor-invalid/`):

  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, and `MessageDisplay`.

- The requested eleven-event subset was then loaded in one settings blob under Q5; six events actually fired in that scenario.

Inline JSON pitfalls observed:

- It must reach Claude as one argv value; shell-quote the entire JSON value. The successful recipe was `inline=$(jq -c . file.json); claude ... --settings "$inline" ...`. Embedded shell quotes in hook commands make hand-written shell literals fragile, so a file is the safer transport.
- Host argv limits apply. Direct `spawn` tests (no shell involved) succeeded with a valid inline JSON argument padded to 917,504 bytes, but failed at 1,048,576 bytes with `E2BIG: argument list too long` (`runs/q1-inline-size-results.json`). This boundary also depends on the rest of argv/environment; use a settings file for large blobs.

## Q2 — SAFE MODE

**VERDICT (2.1.207): `--safe-mode` suppresses both ordinary ambient settings hooks and `--settings`-injected hooks. This is the central release-gate result: mdflow cannot combine `--safe-mode` with per-run `--settings` hooks on 2.1.207.** The suppression was observed in mdflow's relevant combined invocation with `--no-session-persistence`; that flag was held constant rather than separately A/B-tested.

All four runs used `claude -p --no-session-persistence --model haiku`. The ambient-user source was a synthetic `settings.json` in the probe-local `CLAUDE_CONFIG_DIR` (`config-ambient/settings.json`), so no real user settings were changed or invoked.

| Safe mode | Hook source | Hook fired? | Process result |
|---|---|---:|---|
| off | `--settings q2-flag-settings.json` | yes, one `UserPromptSubmit` payload | hook blocked; Claude exit `0` |
| on | `--settings q2-flag-settings.json` | **no** | reached auth in the deliberately credential-free config dir; Claude exit `1`, `Not logged in` |
| off | ambient user `config-ambient/settings.json` | yes, one `UserPromptSubmit` payload | hook blocked; Claude exit `0` |
| on | ambient user `config-ambient/settings.json` | **no** | reached auth; Claude exit `1`, `Not logged in` |

Evidence is in `runs/q2-{off,on}-{flag,ambient}/`. Each off case has `events.ndjson`; each on case has no event file. Safe-mode debug logs say `Skipping plugin hooks - safe mode disables plugins (managed settings-file hooks still run)` and find zero runtime hooks. The parenthetical refers to admin-managed policy settings, not the ordinary `--settings` flag.

## Q3 — SETTING SOURCES

**VERDICT (2.1.207): `--setting-sources ""` is accepted and excludes ordinary `user`, `project`, and `local` settings while preserving `--settings` flag hooks.** This is the verified isolation mechanism mdflow should use instead of `--safe-mode`.

The decisive run placed a blocking hook in each synthetic ambient source (`config-q3-user/settings.json`, `source-project/.claude/settings.json`, and `source-project/.claude/settings.local.json`) plus a fourth hook in `q3-flag-settings.json`. With:

```sh
claude -p \
  --no-session-persistence \
  --setting-sources "" \
  --settings /absolute/path/to/injected-settings.json \
  --model haiku \
  "Reply with the word ok"
```

only `runs/q3-empty-flag/flag.ndjson` was created. No user/project/local event file appeared, and the injected hook blocked normally.

Flag grammar was also probed:

- `user`, `project`, and `local` each loaded exactly its selected source.
- `user,project,local` loaded and ran all three source hooks; all three event files exist under `runs/q3-all/`.
- `banana` failed loudly before a run with exit `1`: `Invalid setting source: banana. Valid options are: user, project, local`.

Artifacts: `runs/q3-empty-flag/`, `runs/q3-user/`, `runs/q3-project/`, `runs/q3-local/`, `runs/q3-all/`, and `runs/q3-invalid/`.

Scope caveat: this excludes the CLI's ordinary user/project/local sources. Admin-managed policy settings are a separate source and are not claimed excludable; no managed settings file existed on this host during the probe. Plugin-contributed hooks were not independently tested with an enabled hook-bearing plugin; the decisive debug log recorded 0 plugins / 0 plugin hooks. Thus “only injected hooks” is proven here for ordinary settings sources on this host, with no explicit plugin and no managed policy.

## Q4 — CONFIG DIR

**VERDICT (2.1.207): a fresh `CLAUDE_CONFIG_DIR` replaces the user-config root, but it is not a complete isolation mechanism and it loses this machine's existing Keychain-backed login. It is not needed when Q3's recipe is used.**

Evidence:

- The inherited effective config root for this probe was `/Users/johnlindquist/.claude-third`; `claude auth status --json` returned `loggedIn: true`, `authMethod: "claude.ai"` (`runs/q4-auth-default/`; identifying account fields are intentionally omitted here).
- With `CLAUDE_CONFIG_DIR=.../claude-probe/config-q4-fresh`, the same read-only auth command returned exit `1`, `loggedIn: false`, `authMethod: "none"` (`runs/q4-auth-fresh/`). No credentials were copied.
- A print-mode prompt with that fresh config returned exit `1`, `Not logged in · Please run /login` (`runs/q4-fresh-prompt/`). Its debug log looked only for user settings at `config-q4-fresh/settings.json`, not the inherited real config root, so user ambient hooks were excluded.
- `CLAUDE_CONFIG_DIR` does **not** exclude project/local settings. Running from `source-project/` with the fresh config still ran both `.claude/settings.json` and `.claude/settings.local.json` hooks (`runs/q4-fresh-project/project.ndjson` and `local.ndjson`).
- Conversely, authenticated completion runs that preserved the inherited config root rewrote its `.claude.json` state despite `--no-session-persistence`. There is no verified recipe from this probe that simultaneously preserves the existing Keychain login and guarantees zero writes to the real config root.

Therefore mdflow should preserve the caller's existing `CLAUDE_CONFIG_DIR` (and its auth namespace), omit `--safe-mode`, and use `--setting-sources ""` plus `--settings <injected-file>`. Also, an empty environment value is not used as a recommendation; if code ever wants the default config root, it should truly unset `CLAUDE_CONFIG_DIR` rather than set it to an empty string.

## Q5 — PAYLOADS + EVENTS

**VERDICT (2.1.207): in the requested one-Bash-tool print run, exactly six of the eleven registered events fired, in this order: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`.** `PermissionRequest`, `PreCompact`, `SubagentStart`, `SubagentStop`, and `Notification` did not fire in this scenario.

Authoritative run:

```sh
claude -p \
  --no-session-persistence \
  --model haiku \
  --max-budget-usd 0.03 \
  --setting-sources "" \
  --settings q5-all-events-settings.json \
  --dangerously-skip-permissions \
  --tools Bash \
  --output-format json \
  'Run the shell command `echo hi` then reply done.'
```

It resolved `haiku` to `claude-haiku-4-5-20251001`, made two model turns, ran Bash input `{"command":"echo hi",...}`, returned `Done.`, had no permission denials, cost `$0.004525`, and exited `0`. `PermissionRequest` did not fire; this is consistent with `--dangerously-skip-permissions` and the observed payload `permission_mode: "bypassPermissions"` (not a separate permission-mode A/B test).

Payload fields observed:

| Event | Fields beyond the shared identity/path fields |
|---|---|
| `SessionStart` | `source: "startup"` |
| `UserPromptSubmit` | `prompt_id`, `permission_mode`, `prompt` |
| `PreToolUse` | `prompt_id`, `permission_mode`, `tool_name: "Bash"`, `tool_input`, `tool_use_id` |
| `PostToolUse` | all tool fields plus `tool_response` and `duration_ms` |
| `Stop` | `prompt_id`, `permission_mode`, `stop_hook_active: false`, `last_assistant_message: "Done."`, `background_tasks: []`, `session_crons: []` |
| `SessionEnd` | `prompt_id`, `reason: "other"` |

Every observed payload also included `session_id`, `transcript_path`, `cwd`, and `hook_event_name`; `SessionStart` did not include `prompt_id` or `permission_mode` in this run.

Byte-level evidence:

- Raw stdin was appended directly to `runs/q5-all-events-byteproof/events.ndjson`.
- It contains 6 lines / 3,795 bytes and has SHA-256 `a93b3393ff79896f146c552148eb1935e96a6d1a8f98d7a148f438546d2732a3`.
- `capture-meta.ndjson` records each pre-write payload length and SHA-256. Every input ended in byte `0a`; the recorder added **zero** separator bytes. Thus the event file is byte-for-byte hook stdin: compact UTF-8 JSON plus one newline per invocation.
- Full process stdout/stderr/result/debug artifacts are in `runs/q5-all-events-byteproof/`.

## Q6 — BLOCKING

**VERDICT (2.1.207): both UserPromptSubmit exit `2` and top-level `{"decision":"block","reason":"..."}` block the prompt before a model answer, but Claude itself exits `0`. A Stop decision-block does the opposite of stopping: it forces another model turn and can loop.**

UserPromptSubmit exit `2`:

- Hook stderr: `probe hook exit 2 stderr`.
- Claude process exit: `0`.
- Claude process stderr: empty.
- Claude stdout contains `UserPromptSubmit operation blocked by hook`, the hook command, the stderr reason, and `Original prompt: ...`.
- Evidence: `runs/q1-file/` (same result in the inline case).

UserPromptSubmit decision JSON on hook stdout:

```json
{"decision":"block","reason":"probe JSON block reason"}
```

- Claude process exit: `0`.
- Claude process stderr: empty.
- Claude stdout: `UserPromptSubmit operation blocked by hook:\nprobe JSON block reason\n\nOriginal prompt: Reply with the word ok\n`.
- Evidence: `runs/q6-user-json/`.

Stop decision JSON:

- The Stop hook returned `{"decision":"block","reason":"probe Stop continuation request"}`.
- The initial assistant response was `ok`. Claude then queried Haiku again with the hook feedback; subsequent Stop payloads had `stop_hook_active: true`.
- The run made 10 model turns and captured 9 Stop invocations before terminating with an empty final result (`runs/q6-stop-json/`). This proves decision-block forces continuation.
- The fixture set `once: true`, but 2.1.207 still invoked the Stop hook repeatedly in this run. Do not rely on `once` here; a Stop-blocking hook needs its own state/`stop_hook_active` guard to avoid a feedback loop.

## Q7 — TRUST / CONSENT

**VERDICT (2.1.207): `--settings` flag hooks run in `-p` mode with no hook-specific consent or bypass flag. Malformed inline JSON syntax is loud; malformed settings files and schema-invalid hook objects are silently ignored in print mode.**

- Q1's file and inline UserPromptSubmit hooks ran without `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or any interactive approval. Claude's `-p` help also states that the workspace trust dialog is skipped in non-interactive mode.
- Q5 used `--dangerously-skip-permissions` only to let the requested Bash tool execute headlessly. It is not required for hook loading or consent.

Validation matrix:

| Malformation | Transport | Observed result |
|---|---|---|
| invalid JSON syntax (`{"hooks": nope}`) | inline | loud exit `1`; process stderr `Error: Invalid JSON provided to --settings` |
| invalid JSON syntax | file | silently ignored; run continued to the deliberately fresh config's `Not logged in` result |
| valid JSON but `hooks` is a string | inline | silently ignored; run continued |
| valid JSON but `hooks` is a string | file | silently ignored; run continued |

No validation diagnostic appeared on process stdout/stderr—or even in the hook-focused debug log—for the three silently ignored cases. Evidence: `runs/q7-inline-syntax/`, `q7-file-syntax/`, `q7-inline-schema/`, and `q7-file-schema/`.

An unknown event key is also a silent per-entry skip in this mode rather than a fatal settings error (Q1); the valid sibling event still ran.

## Q8 — INTERACTIVE PARITY

**VERDICT (2.1.207): YES. The same `--setting-sources "" --settings <file>` recipe is accepted in true interactive mode, and an injected UserPromptSubmit hook runs there.**

The CLI was launched under a PTY without `-p`, using only a probe-local `CLAUDE_CONFIG_DIR`. A deliberately invalid environment API key was supplied only to reach the prompt UI without copying a real credential. After the probe-local trust/onboarding screens, submitting `Reply with the word ok` produced the interactive UI message `UserPromptSubmit operation blocked by hook`, including the hook's exit-2 stderr and original prompt. No model request attributable to that prompt was observed; the hook blocked before any model answer. Background startup/auth traffic was not separately excluded.

An automated PTY replay makes this independently auditable: `q8-interactive-replay.exp` launched the real TUI, waited for the prompt, submitted the text, observed `UserPromptSubmit operation`, and exited after Ctrl-C twice. `runs/q8-interactive-replay/result.json` records exit `0`; its raw 4,029-byte PTY transcript is `pty-transcript.bin` (SHA-256 `64525cf52ac85563e673d2a47a537422ce470b12f5e6daa884395150c895a9b5`). The same directory's `events.ndjson` contains one 652-byte `UserPromptSubmit` payload with `permission_mode: "default"`; capture metadata proves its stdin ended in a newline and was stored without normalization.

## Q9 — FAILURE MODES

**VERDICT (2.1.207): UserPromptSubmit hook exit `1` and a `timeout: 2` overrun are both non-blocking. The model run continues and exits `0`; neither the hook stderr nor a timeout warning is surfaced on normal `claude -p` stdout/stderr.**

| Case | Hook behavior | Claude behavior | Plain `-p` output |
|---|---|---|---|
| exit 1 | recorded stdin, wrote `probe hook exit 1 stderr`, exited `1` | continued to one Haiku turn, result `ok`, exit `0` | stdout `ok\n`; stderr empty |
| timeout | recorded stdin, slept 5 seconds with settings `timeout: 2` | waited about 2 seconds, cancelled/ignored hook, continued to one Haiku turn, result `ok`, exit `0` | stdout `ok\n`; stderr empty |

The exit-1 reason appears only in `--debug hooks` output (`Hook UserPromptSubmit ... error`); the timeout did not produce a matching hook diagnostic even there. JSON-output evidence is under `runs/q9-exit1/` and `runs/q9-timeout/`; default text-output evidence is under `runs/q9-exit1-text-v2/` and `runs/q9-timeout-text-v2/`.

## Q10 — PRECEDENCE

**VERDICT (2.1.207): user-settings hooks and `--settings` flag hooks for the same event aggregate; the flag does not replace the user hook.**

The test selected the synthetic `user` source and added a distinct flag hook, both on `UserPromptSubmit`:

```sh
CLAUDE_CONFIG_DIR=.../config-q3-user \
claude -p --setting-sources user --settings q3-flag-settings.json ...
```

Both commands ran. `runs/q10-user-plus-flag/user.ndjson` and `flag.ndjson` each contain one payload with the same `session_id`, `prompt_id`, and prompt; both hash to `9f4018be220c89c6c3e5d96ef7777fd1f4415252748a3c4ef092a541f3c8264` because the stdin payload was identical. Claude exited `0` after the aggregate hook result blocked the prompt. Distinct marker commands were used, so command deduplication could not obscure the merge behavior.

## Summary for implementers

**Pinned conclusion for Claude Code 2.1.207:** mdflow must remove `--safe-mode` from any run that needs injected hooks. Use an absolute settings-file path and an empty ordinary-source list:

```sh
claude -p \
  --no-session-persistence \
  --setting-sources "" \
  --settings "$injected_settings_file" \
  ...
```

Minimal injected file:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/hook-command",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Implementation rules:

- Preserve the caller's existing `CLAUDE_CONFIG_DIR`; a fresh directory lost the existing login and still did not suppress project/local settings. `CLAUDE_CONFIG_DIR` is unnecessary for hook isolation.
- Preserving that config root is **not** filesystem-write isolation: 2.1.207 rewrote its `.claude.json` state during authenticated print runs despite `--no-session-persistence`. If mdflow requires a zero-write user-config boundary, that remains unresolved by this recipe.
- Do **not** pass `--safe-mode`; it suppresses flag hooks as well as ambient hooks.
- `--setting-sources ""` excludes ordinary `user`, `project`, and `local` settings while retaining `--settings` flag hooks. On the tested host there were no explicit plugin hooks or managed policy hooks. Managed policy remains unavoidable, and enabled plugin-hook behavior was not independently probed.
- No hook-specific trust/consent bypass is needed in `-p`. Tool permission flags such as `--dangerously-skip-permissions` are separate and only needed when the requested model run must execute tools headlessly.
- Prefer a settings file. Inline JSON works, but must be one correctly quoted argv value and is subject to the host argument limit (917,504 bytes succeeded; 1,048,576 bytes failed here).

For the verified one-Bash-tool print run, lifecycle order was:

```text
SessionStart -> UserPromptSubmit -> PreToolUse -> PostToolUse -> Stop -> SessionEnd
```

Registered but not triggered in that scenario: `PermissionRequest` (bypassed permissions), `PreCompact`, `SubagentStart`, `SubagentStop`, and `Notification`.

Command-hook stdin contract:

- UTF-8 compact JSON followed by exactly one newline (`0a`). The byte-proof run recorded all six payloads without adding or changing a byte.
- Every observed event had `session_id`, `transcript_path`, `cwd`, and `hook_event_name`.
- Prompt/tool events added `prompt_id` and `permission_mode`; UserPromptSubmit added `prompt`; tool events added `tool_name`, `tool_input`, and `tool_use_id`; PostToolUse added `tool_response` and `duration_ms`; Stop added `stop_hook_active` and the last assistant/background state; SessionEnd added `reason`.

Blocking/failure contract:

- UserPromptSubmit hook exit `2`: stderr becomes the block reason; no model answer; Claude process exit `0`; block report is on Claude stdout and Claude process stderr is empty.
- UserPromptSubmit hook stdout `{"decision":"block","reason":"..."}`: same block behavior and Claude exit `0`.
- Hook exit `1` or timeout: non-blocking; the model run continues; normal `-p` stdout/stderr does not surface the hook failure.
- Stop `decision:"block"`: injects feedback and forces another model turn. It can loop; explicitly guard on `stop_hook_active` or external state. The tested `once:true` did not prevent repetition on 2.1.207.
- User plus flag hooks aggregate when both sources are enabled. The isolation recipe avoids that by selecting no ordinary sources.
- Invalid inline JSON syntax fails loudly. Invalid settings files/schema and unknown event entries are silent in normal `-p`; validate generated settings before launch or use `claude doctor` for diagnostics.
