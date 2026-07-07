# Keeping mdflow.dev and the repo docs in sync

Status: **executed 2026-07-06** (same day as the audit below). What landed:

- The site lives at `site/` in this repo (imported from the
  `johnlindquist/mdflow.dev` working tree; `.vercel` local link state and
  caches excluded).
- `scripts/generate-facts.ts` derives engines (adapter registry), the default
  engine (`DEFAULT_ENGINE`), subcommands (scanned from `cli-runner.ts` —
  an undocumented subcommand fails the build), md-flags, ladder, and base
  version into `site/src/facts.json`. `ManPage.tsx` and `Hero.tsx` render
  from it. `bun run facts` regenerates; `bun run facts:check` is wired into
  `.github/workflows/test.yml`.
- `package.json` gained a `files:` whitelist (tarball: 248 files/510kB →
  82 files/201kB; `site/` can never ship to npm).
- `site/vercel.json` carries the ignore-build command so CLI-only pushes
  don't redeploy the site.

## Remaining manual steps (Vercel dashboard, one-time)

1. In the Vercel project **mdflow.dev** (`prj_GJKQu4COb2mF7TOutclFWxLnQ8cx`),
   switch the connected Git repository to `johnlindquist/mdflow` and set
   **Root Directory = `site`** (keep "Include files outside root directory"
   off).
2. Confirm the production branch matches this repo's default branch (`main`).
3. After the first successful deploy from this repo, archive the old
   `johnlindquist/mdflow.dev` repo (its art-history stays browsable there).

Conventions from here on: site-only commits use `chore(site):` /
`docs(site):` scopes so semantic-release never cuts a CLI release for a
visual tweak.

---

The original proposal follows, for the reasoning of record. Written
2026-07-06 after a full audit of the site against the shipped
`mdflow@3.0.0` CLI.

## What the audit found

The site (johnlindquist/mdflow.dev, Vercel → https://mdflow.dev) is a React
SPA whose factual copy lives hardcoded in TSX components. As of the audit it
is **accurate** — every command, flag, engine, and story checked out against
the CLI source. The drift was on the repo side (v2-era README sections, an
undocumented registry, a stale release status), all fixed in the same pass.

The lesson: the site and the docs drift independently because there are
four copies of the same facts — `src/cli.ts` `printHelp()`, `README.md`,
`docs/public-api.md`, and the site's `ManPage.tsx`/`Hero.tsx` — and nothing
enforces agreement.

## Recommendation: move the site into this repo (`site/`)

Bring mdflow.dev in as a `site/` directory and archive the separate repo.

Why this is the right call here:

- **Atomic PRs.** A feature that adds a subcommand touches code, help text,
  README, public-api, and the site man page in one reviewable diff. Cross-repo
  sync always leaves a drift window; same-repo sync makes drift a review
  comment.
- **CI can enforce sync** (see the facts module below) only when both sides
  are visible to the same check.
- Both repos have the same single maintainer — there is no organizational
  reason for the split, only historical (AI Studio export).

Mechanics:

1. Import the site (squash import into `site/` is fine — its history is
   almost entirely visual-art commits; keep the old repo archived for it).
2. Vercel: point the existing project at this repo with **Root Directory =
   `site/`**, and set the ignored-build step to
   `git diff --quiet HEAD^ HEAD -- site/` so CLI-only pushes don't redeploy.
3. semantic-release: site-only changes use `chore(site): …` / `docs(site): …`
   commit scopes so they never trigger a CLI release. (Optionally add a
   commit-lint rule that anything touching only `site/` must use that scope.)
4. Keep `site/` out of the npm package. **Verified: package.json has no
   `files:` whitelist and there is no `.npmignore`**, so today npm packs
   everything untracked-by-.gitignore (248 files). Adding a `files:`
   whitelist (`src`, `bin`, `assets`, `skills`, `README.md`, `docs`) is a
   prerequisite for the move — and a good hygiene fix regardless.

## The sync mechanism: one generated facts module

Moving the repo makes sync *possible*; a facts module makes it *checked*.
The drift-prone content is small and enumerable:

- subcommand list + one-line descriptions
- reserved/md-specific flags
- engine list + default engine
- the engine-resolution ladder
- current version / dist-tags
- the install one-liner (`npx mdflow init`)

Add `scripts/generate-facts.ts` that derives these from source (the adapter
registry export, a new shared `SUBCOMMANDS` table that `printHelp()` also
renders from, `package.json`) and emits:

- `site/src/facts.json` — imported by `ManPage.tsx`, `Hero.tsx`, and the
  version badge instead of hardcoded strings.
- optionally `docs/public-api.md` tables (regenerate-in-place between
  markers).

CI job `docs-sync`: run the generator, `git diff --exit-code`. A PR that
changes the CLI surface without regenerating fails; regenerating updates the
site copy in the same PR. Artistic copy (headlines, shaders, easter eggs)
stays hand-written and is never checked — only facts are.

## Dogfood layer (optional, very on-brand)

A `flows/site-audit.md` flow that imports `@./site/src/facts.json`,
`@./docs/public-api.md`, and the site's content components, and asks the
engine to list contradictions — with an eval case that plants a fake drift
(e.g., a bogus flag in a fixture) and checks it gets flagged. The tool that
promises "evals prove behavior" proving its own website is the story writing
itself.

## If the site stays in its own repo (fallback)

- Publish `facts.json` from this repo (commit it; raw.githubusercontent URL).
- The site fetches it at build time; a `repository_dispatch` from this repo's
  release workflow triggers a Vercel rebuild on every release.
- Weaknesses: the drift window between release and rebuild, two CI setups,
  and no single reviewable diff. Workable, strictly worse.
