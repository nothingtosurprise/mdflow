/**
 * Claude CLI adapter
 *
 * Print mode: --print flag for non-interactive output
 * Interactive mode: Remove --print flag (interactive is the default)
 *
 * Isolation (`_isolated: true`): --safe-mode disables CLAUDE.md, skills,
 * plugins, hooks, MCP servers, custom commands/agents, output styles, and
 * workflows while auth, model selection, built-in tools, and permissions
 * keep working (verified against claude --help; --bare is NOT used here
 * because it restricts auth to ANTHROPIC_API_KEY only, which would break
 * subscription/OAuth users). --no-session-persistence skips writing the
 * session to disk; it only works with --print, so interactive mode strips
 * it.
 *
 * System prompt: --system-prompt replaces, --append-system-prompt appends.
 */

import type {
  ToolAdapter,
  CommandDefaults,
  AgentFrontmatter,
  SystemPromptSpec,
  SystemPromptTranslation,
  HooksSpec,
  HooksTranslation,
} from "../types";
import {
  buildClaudeHooksSettings,
  buildClaudeHooksSettingsValue,
  type CanonicalHookEvent,
} from "../hooks";
import { CommandError } from "../errors";

export const claudeAdapter: ToolAdapter = {
  name: "claude",

  getDefaults(): CommandDefaults {
    return {
      print: true, // --print flag for non-interactive mode
    };
  },

  applyInteractiveMode(frontmatter: AgentFrontmatter): AgentFrontmatter {
    const result = { ...frontmatter };
    // Remove --print flag (interactive is default without it)
    delete result.print;
    // --no-session-persistence only works with --print
    delete result["no-session-persistence"];
    return result;
  },

  getIsolationDefaults(): CommandDefaults {
    return {
      "safe-mode": true,
      "no-session-persistence": true,
    };
  },

  /**
   * Hooks ride in via `--settings <inline JSON>` — Claude Code's per-run
   * settings channel. Verified on Claude Code 2.1.207
   * (docs/claude-hooks-probe-2026-07.md):
   *
   * - `--safe-mode` SUPPRESSES `--settings` hooks (and all ambient hooks), so
   *   a hooked run cannot use it. mdflow drops `--safe-mode` here and instead
   *   excludes ambient settings with `--setting-sources ""` (which keeps the
   *   injected `--settings` hooks while dropping user/project/local settings
   *   and THEIR hooks — the security parallel to codex's prepared home; no
   *   trust-bypass exists on claude).
   * - Dropping `--safe-mode` also stops disabling CLAUDE.md, skills, plugins,
   *   and MCP. That is a real reduction in context isolation, so it is
   *   DISCLOSED (never silent). Managed/admin policy hooks, if any, remain.
   * - No hook-specific consent flag is needed in print mode.
   *
   * Hooks require isolation (parity with codex, and because the recipe
   * deliberately manipulates setting-sources). The flow must not also set a
   * native `settings:` — that ownership conflict hard-fails upstream.
   */
  applyHooks(spec: HooksSpec): HooksTranslation {
    if (!spec.isolated) {
      throw new CommandError(
        `Flow hooks on claude require isolation (the default). Remove ` +
          `\`_isolated: false\` or set \`_hooks: false\`.`,
        { errorCode: "HOOKS_REQUIRE_ISOLATION", context: { hooksFile: spec.hooksFile } }
      );
    }
    const settings = buildClaudeHooksSettings({
      hooksFile: spec.hooksFile,
      events: spec.events as CanonicalHookEvent[],
    });
    return {
      frontmatter: {
        settings: buildClaudeHooksSettingsValue(settings),
        // Exclude ambient user/project/local settings (and their hooks) while
        // keeping our injected --settings hooks.
        "setting-sources": "",
        // --safe-mode would suppress the injected hooks; it must be off.
        "safe-mode": false,
      },
      exclusiveKeys: ["settings"],
      warnings: [
        "Warning [HOOKS_ISOLATION_REDUCED]: claude hooks require dropping " +
          "--safe-mode, so CLAUDE.md, skills, plugins, and MCP are NOT " +
          "disabled for this run (ambient settings and their hooks are still " +
          "excluded via --setting-sources ''). Managed/admin policy hooks, if " +
          "configured, also still apply.",
      ],
    };
  },

  applySystemPrompt(spec: SystemPromptSpec): SystemPromptTranslation {
    const frontmatter: Record<string, string> = {};
    if (spec.replace !== undefined) frontmatter["system-prompt"] = spec.replace;
    if (spec.append && spec.append.length > 0) {
      // claude takes a single --append-system-prompt value; join segments.
      frontmatter["append-system-prompt"] = spec.append.join("\n\n");
    }
    return { frontmatter };
  },
};

export default claudeAdapter;
