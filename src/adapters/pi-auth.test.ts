/**
 * Tests for the pi subscription auth bridge — pure merge logic only, no real
 * credential files are ever read or written here.
 */

import { expect, test, describe } from "bun:test";
import { mergeAuthSources, codexCliToPiEntry, type AuthEntry } from "./pi-auth";

function jwtWithExp(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds }), "utf8").toString("base64url");
  return `header.${payload}.sig`;
}

const HOUR = 3600;
const NOW_S = 1_800_000_000;

function oauth(expiresMs: number): AuthEntry {
  return { type: "oauth", access: "a", refresh: "r", expires: expiresMs };
}

describe("codexCliToPiEntry", () => {
  test("bridges Codex CLI tokens into pi oauth format", () => {
    const entry = codexCliToPiEntry({
      tokens: {
        access_token: jwtWithExp(NOW_S + HOUR),
        refresh_token: "refresh-me",
        account_id: "acct-1",
      },
    });

    expect(entry).toEqual({
      type: "oauth",
      access: jwtWithExp(NOW_S + HOUR),
      refresh: "refresh-me",
      expires: (NOW_S + HOUR) * 1000,
      accountId: "acct-1",
    });
  });

  test("returns undefined for missing tokens or unparseable JWT", () => {
    expect(codexCliToPiEntry({})).toBeUndefined();
    expect(codexCliToPiEntry({ tokens: { access_token: "not-a-jwt", refresh_token: "r" } })).toBeUndefined();
  });
});

describe("mergeAuthSources", () => {
  test("real pi logins are the base", () => {
    const merged = mergeAuthSources({
      realPi: { anthropic: { type: "api_key", key: "sk-x" } },
    });
    expect(merged.anthropic).toEqual({ type: "api_key", key: "sk-x" });
  });

  test("codex CLI token wins openai-codex slot when fresher", () => {
    const staleMs = (NOW_S - HOUR) * 1000;
    const merged = mergeAuthSources({
      realPi: { "openai-codex": oauth(staleMs) },
      codexCli: {
        tokens: { access_token: jwtWithExp(NOW_S + HOUR), refresh_token: "r" },
      },
    });
    expect((merged["openai-codex"] as { expires: number }).expires).toBe((NOW_S + HOUR) * 1000);
  });

  test("stale codex token never displaces a fresher pi login", () => {
    const freshMs = (NOW_S + 2 * HOUR) * 1000;
    const merged = mergeAuthSources({
      realPi: { "openai-codex": oauth(freshMs) },
      codexCli: {
        tokens: { access_token: jwtWithExp(NOW_S - HOUR), refresh_token: "r" },
      },
    });
    expect((merged["openai-codex"] as { expires: number }).expires).toBe(freshMs);
  });

  test("bridge entries win only when strictly fresher than real pi", () => {
    const merged = mergeAuthSources({
      bridge: { "openai-codex": oauth(5000), anthropic: { type: "api_key", key: "bridge-key" } },
      realPi: { "openai-codex": oauth(9000) },
    });
    expect((merged["openai-codex"] as { expires: number }).expires).toBe(9000);
    // Non-oauth bridge entry fills the gap when pi has nothing for it.
    expect(merged.anthropic).toEqual({ type: "api_key", key: "bridge-key" });
  });
});
