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
- For flake changes, validate all declared systems (`nix flake check`, or at
  minimum `nix eval` of each `devShells.<system>.default`).
- State in the PR body which checks were run and their results.

## Project notes

- Node >= 22.19 (Pi's engines requirement). `nix develop` provides the full
  dev shell: node, git, and platform notification tools.
- Package management is pnpm (pinned via `packageManager` in `package.json` and
  provided by the Nix dev shell). Use pnpm — not npm — for installs and scripts.
- The `pi` manifest in `package.json` is the loading contract for package
  installs — keep `pi.extensions` accurate when moving or adding extension
  entry points.
