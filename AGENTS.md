# AGENTS.md

Workflow rules for AI coding agents and humans working in this repository.
These rules are mandatory — if a task seems to conflict with them, stop and
ask instead of deviating.

## Branches and pull requests

- Never push directly to `main`. It is protected; GitHub rulesets reject
  direct pushes (GH013). All changes arrive through pull requests.
- Work on short-lived branches named `<type>/<short-description>`
  (e.g. `fix/pi-manifest`, `docs/agents-md`).
- PRs must be focused: one logical change per PR. Never bundle unrelated
  changes — "while we're here" edits get their own PR.
- Never merge a PR yourself unless the user explicitly instructs it as an
  exception. Open the PR, report the link, and stop.
- Merging is a human decision by default.

## Merging

- Rebase merges only. It is the project convention and the only strategy the
  repository rulesets allow (squash merges and merge commits are disabled).
- Keep every commit on a branch self-contained and buildable, because each
  commit lands on `main` verbatim.

## Commit messages

- Follow Conventional Commits: `type(scope): summary`.
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `chore`, `ci`.
- Summary line: imperative mood, lowercase after the type, no trailing
  period.
- The body is required for any non-trivial change: explain what changed and
  why, including constraints discovered along the way.

## Pull request descriptions

- Describe in detail: what changed, why it is needed, how it was verified
  (commands run and their results), and any follow-up work.
- Link to related issues or prior PRs when relevant.

## Side-missions and follow-ups

- Work stays focused: when a task uncovers a bug, quirk, refactor idea, or any
  other out-of-scope work, do not fold it into the current change by default.
  File a GitHub issue immediately with `gh issue create` — clear title, what
  was found, where, why it matters, and a suggested approach if known.
- Always file issues for follow-ups discovered during work, even small ones;
  the issue is the memory, not the conversation.
- Mention the new issue in the current PR body so the discovery stays
  traceable, then continue with the original task.
- Narrow exception: a fix that the current change itself requires in order to
  be correct (e.g. a bug in the code being modified that the new tests
  expose) may stay in the same PR, but it must be called out explicitly in
  the PR body.

## Releases and publishing

- Cutting a release is the owner's job. Agents may prepare release PRs (e.g.
  via `pnpm release`, which bumps the version and opens the PR), but release
  actions themselves are owner-only:
- Never create, push, or delete git tags — no `git tag`,
  `git push origin <tag>`, or `git push --delete origin <tag>`.
- Never create or modify GitHub releases — no `gh release create/edit/upload`.
- Never publish to npm — no `pnpm publish` or `npm publish`. A plain
  `npm publish --dry-run` is allowed for verifying package contents.
- Versions are `vX.Y.Z` semver git tags on `main`; the first release is
  v0.1.0. Cutting a release is a deliberate owner action: push the tag
  (`git tag vX.Y.Z && git push origin vX.Y.Z`) and the release workflow
  (`.github/workflows/release.yml`) creates the GitHub release and publishes
  to npm on the owner's behalf. Merging a version bump alone never releases.
  That workflow is the only thing allowed to perform release actions —
  agents still never run them locally.

## Handling local changes

- Never blindly discard changes. Do not use `git restore .`, `git checkout .`,
  `git reset --hard`, or delete files as "cleanup" without being sure.
- When uncommitted work is in the way, stash it: `git stash push -m "..."`
  (with a descriptive message). Only drop a stash deliberately.
- Discard changes only when absolutely certain they are not needed anymore —
  and state that reasoning explicitly before discarding.
- Lesson learned in this repo: staged-but-uncommitted files are swept into
  the next `git commit`, and unstaged files are wiped by `git reset --hard`.
  Check `git status` before every commit or reset.

## Verification before opening a PR

- `pnpm run check` must pass (TypeScript typecheck against the Pi extension
  types).
- `pnpm test` must pass (zero-dependency node:test suite covering the pure
  helpers and the extension's event flow via a fake ExtensionAPI).
- For flake changes, validate all declared systems (`nix flake check`, or at
  minimum `nix eval` of each `devShells.<system>.default`).
- State in the PR body which checks were run and their results.

## Project notes

- Node >= 22.19 (Pi's engines requirement). `nix develop` provides the full
  dev shell: node, git, and platform notification tools.
- Package management is pnpm (pinned via `packageManager` in `package.json` and
  provided by the Nix dev shell). Use pnpm — not npm — for installs and scripts.
- If direnv is set up, the dev shell (node, pnpm, git, notification tools) loads
  automatically under this repo after a one-time `direnv allow` by the user;
  otherwise run commands through `nix develop -c sh -c '...'`.
- The `pi` manifest in `package.json` is the loading contract for package
  installs — keep `pi.extensions` accurate when moving or adding extension
  entry points.
