# Contributing to mdflow

mdflow turns markdown into executable agent workflows. Changes to parsing,
trust, imports, engine adapters, evals, or release automation can alter what
runs on a user's machine, so tests should cover both the intended behavior and
the refusal path.

## Local setup

Install [Bun](https://bun.sh), then:

```bash
bun install --frozen-lockfile
bun run verify
```

For site changes:

```bash
cd site
bun install --frozen-lockfile
bun run verify
```

`bun run verify` type-checks the source, runs the full test suite, checks the
generated public facts, and installs the packed npm artifact in a clean
temporary consumer.

## Pull requests

- Keep behavior changes focused and add a regression test.
- Preserve compatibility aliases unless the change is explicitly breaking.
- Update `docs/public-api.md` when the CLI or error contract changes.
- Keep README and site claims narrower than the implementation. In particular,
  distinguish engine context isolation from a host sandbox, and distinguish a
  no-regression eval gate from proof that an uncaptured complaint was fixed.
- Do not commit credentials, generated local state, or `.env.local`.
- Use a Conventional Commit subject so semantic-release can classify the
  change. Add `!` and a `BREAKING CHANGE:` footer for intentional breaks.

Before opening a PR, run both verification commands above and include the
relevant output or reproduction steps in the PR description.
