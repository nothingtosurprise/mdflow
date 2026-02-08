# mdflow public API reference

This document defines the stable user-facing API for `mdflow` CLI usage.

## CLI command contract

Run `mdflow` or `md` with one of these forms:

```bash
md <agent.md> [flags...]
md <subcommand> [options...]
md.<command> "prompt" [flags...]   # ad-hoc, no file required
```

Supported subcommands:

| Command | Description |
| --- | --- |
| `md create [name]` | Create a new agent file. |
| `md explain <agent.md>` | Print resolved config and prompt without execution. |
| `md setup` | Configure shell integration. |
| `md logs` | Show log directory and per-agent logs. |
| `md help` | Print CLI help. |

## mdflow-reserved flags

These flags are consumed by mdflow and are not passed to underlying LLM CLIs.

| Flag | Description |
| --- | --- |
| `--_command`, `-_c` | Override command resolution for generic `.md` files. |
| `--_dry-run` | Print resolved command/prompt without execution. |
| `--_edit` | Open resolved prompt in `$EDITOR` before execution. |
| `--_trust` | Skip TOFU trust prompt for remote URLs. |
| `--_no-cache` | Bypass remote URL cache. |
| `--_context` | Print context tree and exit. |
| `--_quiet` | Skip preflight context dashboard. |
| `--_no-menu` | Disable post-run action menu. |
| `--raw` | Emit raw markdown output (no terminal renderer). |

Interactive mode controls are also supported:

| Flag | Description |
| --- | --- |
| `--_interactive`, `-_i` | Force interactive mode for supported adapters. |

## Frontmatter contract

### Core behavior

- All non-system frontmatter keys are forwarded as CLI flags.
- Values map as:
  - `key: "value"` -> `--key value`
  - `key: true` -> `--key`
  - `key: false` -> omitted
  - `key: [a, b]` -> `--key a --key b`

### System keys

| Key | Type | Behavior |
| --- | --- | --- |
| `_inputs` | `string[]` or typed object | Declares template variables and prompt UI. |
| `_env` | `Record<string, string \| number \| boolean>` | Sets environment variables for command execution. Values are coerced to strings. |
| `_interactive`, `_i` | boolean-ish | Enables interactive mode transforms. |
| `_cwd` | string | Overrides execution working directory for inlines/commands. |
| `_subcommand` | string or string[] | Prepends subcommand tokens to generated args. |
| `$1`, `$2`, ... | string | Maps positional prompt body to named flag(s). |
| `context_window` | number | Overrides context token-window estimation. |

### `_inputs` typed object format

Each `_inputs` key must start with `_`, and each value must be one of:

- `text`: optional `default` (string)
- `select`: required `options` (non-empty string array), optional `default`
- `number`: optional `default`, `min`, `max`
- `confirm`: optional `default` (boolean)
- `password`: optional `default` (string)

## Configuration files and precedence

Configuration merge order (lowest -> highest precedence):

1. Built-in command defaults.
2. Global config: `~/.mdflow/config.yaml`.
3. Project config at git root:
   - `mdflow.config.yaml`
   - `.mdflow.yaml`
   - `.mdflow.json`
4. Project config at current working directory (same file names).
5. Agent frontmatter.
6. CLI passthrough flags.

Within a single directory, lookup order is:

1. `mdflow.config.yaml`
2. `.mdflow.yaml`
3. `.mdflow.json`

## URL import policy API

URL imports (`@https://...`) support only `http://` and `https://`.

Policy environment variables:

| Variable | Purpose |
| --- | --- |
| `MDFLOW_IMPORT_URL_ALLOWLIST` | Allowlist rules (comma/newline-separated). |
| `MDFLOW_IMPORT_URL_BLOCKLIST` | Blocklist rules (comma/newline-separated). |
| `MDFLOW_URL_ALLOWLIST` | Legacy alias for allowlist. |
| `MDFLOW_URL_BLOCKLIST` | Legacy alias for blocklist. |

Rule formats:

- Hostname: `example.com`
- Host+port: `example.com:8443`
- Wildcard domain: `*.example.com`
- URL prefix: `https://example.com/v1/`
- Match-all: `*`

Blocklist is evaluated before allowlist.

## Timeout environment variables

| Variable | Default (ms) | Applies to |
| --- | --- | --- |
| `MDFLOW_FETCH_TIMEOUT` | `10000` | HTTP fetch operations. |
| `MDFLOW_COMMAND_TIMEOUT` | `30000` | Inline command execution. |
| `MDFLOW_AGENT_TIMEOUT` | `0` | Agent process execution (`0` means disabled). |

## Error codes

Structured failures expose stable error codes, shown as:

```text
[ERROR_CODE] message
```

Known error codes:

| Code | Meaning |
| --- | --- |
| `MDFLOW_UNKNOWN` | Unknown/untyped failure. |
| `CONFIG_FILE_READ_FAILED` | Config file could not be read. |
| `CONFIG_FILE_PARSE_FAILED` | Config file parse error (YAML/JSON). |
| `CONFIG_FILE_VALIDATION_FAILED` | Config failed schema validation. |
| `CONFIG_FILE_DISCOVERY_FAILED` | Config discovery or git-root lookup failed. |
| `ENV_FILE_READ_FAILED` | `.env` file could not be read. |
| `IMPORT_FILE_NOT_FOUND` | Local import path missing. |
| `IMPORT_FILE_READ_FAILED` | Local import path exists but could not be read. |
| `IMPORT_BINARY_FILE` | Binary import rejected. |
| `IMPORT_CIRCULAR_DEPENDENCY` | Circular import detected. |
| `IMPORT_COMMAND_FAILED` | Inline command import failed. |
| `IMPORT_URL_FETCH_FAILED` | URL import fetch or policy check failed. |
| `COMMAND_MISSING` | No command could be resolved. |
| `COMMAND_INVALID` | Invalid command token format. |
| `COMMAND_NOT_FOUND` | Command binary not available on `PATH`. |
| `COMMAND_EXECUTION_FAILED` | Spawned command failed at runtime. |
| `TEMPLATE_MISSING_VARIABLE` | Required template variable missing. |
| `TEMPLATE_PROCESSING_FAILED` | Liquid/template processing failed. |
| `SECURITY_TRUST_FAILED` | Trust or security policy validation failed. |
| `INPUT_LIMIT_EXCEEDED` | Input/context limit exceeded. |
| `NETWORK_REQUEST_FAILED` | Generic network request failure. |
| `HOOK_EXECUTION_FAILED` | Hook execution failed. |
| `VALIDATION_FAILED` | Generic validation failure. |
| `USER_CANCELLED` | User cancelled interactive operation. |
| `EARLY_EXIT` | Non-error early termination path. |
