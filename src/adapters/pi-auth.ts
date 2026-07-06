/**
 * Subscription auth bridge for the pi engine.
 *
 * pi's `openai-codex` provider uses the SAME OAuth client as the Codex CLI,
 * so the tokens the Codex CLI keeps fresh in ~/.codex/auth.json are drop-in
 * valid for pi. pi itself, however, only refreshes on use — a stale
 * ~/.pi/agent/auth.json entry fails with "No API key found" even though the
 * user's Codex login is perfectly fresh.
 *
 * mdflow maintains ONE bridged agent dir at ~/.mdflow/pi-agent/ and points
 * every pi spawn at it via PI_CODING_AGENT_DIR (see piAdapter.prepareEnv):
 *
 *   1. Start from the user's real pi logins (~/.pi/agent/auth.json) so any
 *      provider they logged into with `pi /login` works here too.
 *   2. For openai-codex, pick whichever token expires LATEST among the
 *      current bridge file, the real pi auth, and ~/.codex/auth.json
 *      (bridged into pi's format).
 *   3. If pi refreshes mid-run, the refreshed credential lands in the
 *      bridged file, not the user's real one.
 *
 * The bridged dir doubles as isolation: pi's settings.json (default
 * provider/model, extensions) lives in the real agent dir and is deliberately
 * NOT copied — ambient machine config must not leak into flows.
 *
 * Nothing here ever writes to ~/.codex/auth.json or ~/.pi/agent/auth.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

interface OAuthEntry {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export type AuthEntry = OAuthEntry | { type: string; [k: string]: unknown };

export function bridgedPiAgentDir(): string {
  return join(homedir(), ".mdflow", "pi-agent");
}

export function bridgedPiAuthPath(): string {
  return join(bridgedPiAgentDir(), "auth.json");
}

export function realPiAuthPath(): string {
  return join(homedir(), ".pi", "agent", "auth.json");
}

export function codexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "auth.json");
}

function readJson(path: string): Record<string, any> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function jwtExpiresMs(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** ~/.codex/auth.json (Codex CLI format) -> pi openai-codex oauth entry. */
export function codexCliToPiEntry(codexAuth: Record<string, any>): OAuthEntry | undefined {
  const t = codexAuth?.tokens;
  if (!t?.access_token || !t?.refresh_token) return undefined;
  const expires = jwtExpiresMs(t.access_token);
  if (!expires) return undefined;
  return {
    type: "oauth",
    access: t.access_token,
    refresh: t.refresh_token,
    expires,
    accountId: t.account_id,
  };
}

function oauthExpires(entry: AuthEntry | undefined): number {
  return entry && entry.type === "oauth" && typeof (entry as OAuthEntry).expires === "number"
    ? (entry as OAuthEntry).expires
    : -1;
}

/**
 * Merge auth sources. Pure so tests never touch real credential files.
 * Real pi logins are the base; existing bridge entries win only when strictly
 * fresher; the Codex CLI token wins the openai-codex slot when freshest.
 */
export function mergeAuthSources(input: {
  bridge?: Record<string, AuthEntry>;
  realPi?: Record<string, AuthEntry>;
  codexCli?: Record<string, any>;
}): Record<string, AuthEntry> {
  const merged: Record<string, AuthEntry> = { ...(input.realPi ?? {}) };

  for (const [provider, entry] of Object.entries(input.bridge ?? {})) {
    const current = merged[provider];
    if (!current || oauthExpires(entry) > oauthExpires(current)) merged[provider] = entry;
  }

  const codexEntry = input.codexCli ? codexCliToPiEntry(input.codexCli) : undefined;
  if (codexEntry && oauthExpires(codexEntry) > oauthExpires(merged["openai-codex"])) {
    merged["openai-codex"] = codexEntry;
  }

  return merged;
}

/**
 * Ensure the bridged agent dir exists with the freshest credentials and
 * return it. Cheap (three small file reads); called once per pi spawn.
 */
export function ensureBridgedPiAgentDir(): string {
  const dir = bridgedPiAgentDir();
  const path = bridgedPiAuthPath();
  const merged = mergeAuthSources({
    bridge: readJson(path),
    realPi: readJson(realPiAuthPath()),
    codexCli: readJson(codexAuthPath()),
  });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2), { mode: 0o600 });
  } catch {
    // If the write fails but a previous bridge file exists, use it as-is.
    if (!existsSync(path)) throw new Error(`cannot write bridged pi auth file at ${path}`);
  }
  return dir;
}
