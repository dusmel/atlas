# Atlas Project Status

## Goal

Atlas is a personal CLI that promotes active git repos into a centralized atlas store and keeps repo-local planning material accessible through a stable `atlas/` symlink.

## What Works

### Core commands

- `atlas ensure`
- `atlas promote`
- `atlas observe`
- `atlas status`

### Promotion model

- Promoted repos get `repoRoot/atlas` as a symlink.
- Target storage lives under `~/MEGA/Documents/atlas/repos/<repoId>` by default.
- Promotion writes `meta.json` with `repoId`, `id`, `repoRoot`, `remoteUrl`, and `updatedAt`.
- `.git/info/exclude` is updated so git ignores `atlas`.

### Repo naming

- Preferred promoted name is the local repo basename.
- Stable unique identity is stored separately as `id`.
- Name collisions are handled by:
  - interactive prompt for manual `atlas promote`
  - headless suggested name for hook-driven promotion
- Existing promoted repos are rediscovered by scanning `meta.json` files.

### Content migration

- On promotion, repo-root `plans/` and `notes/` are copied into the promoted atlas dir.
- If a real `atlas/` directory already exists in the repo, its `plans/` and `notes/` are migrated before it is replaced by the symlink.

### Candidate scoring

- Activity is tracked in `state/candidates/<repoId>.json`.
- Scoring is token-based, not regex-heavy.
- Aliases like `gst`, `ga`, `gaa`, `c`, `vi`, and `v` are normalized before scoring.
- Default promotion threshold is `4`.
- Candidate score resets after `48h` of inactivity.

### Shell hooks

- Zsh hooks live in `~/.zsh/hooks/atlas.zsh`.
- `preexec` only records interesting commands.
- `precmd` runs `atlas observe` in the background.

### Tests

- 102 passing tests.
- Coverage favors behavior and outcome over internal implementation.
- Covered areas:
  - git discovery
  - promotion
  - collisions
  - state persistence
  - scoring
  - status
  - CLI end-to-end behavior

## Important Decisions

### Symlink name is always `atlas`

- Not `.atlas`
- Not the project basename
- Always `repoRoot/atlas`

### Human name and unique identity are separate

- `repoId`: human-friendly promoted directory name
- `id`: stable disambiguation identity

### Config is dynamic at runtime

- `src/config.ts` exposes runtime helpers:
  - `atlasRoot()`
  - `reposDir()`
  - `stateDir()`
  - `threshold()`
  - `staleSeconds()`
- This allows env overrides and makes tests reliable.

## Known Rough Edges

- Existing promoted dirs are found by scanning `meta.json` files, which is fine for personal scale but not optimized.
- Interactive collision resolution is basic stdin prompting.
- Only `plans/` and `notes/` are migrated today.
- Runtime assumes `git` is available on PATH.

## Backlog

### High value

- Add `atlas list` for promoted repos and active candidates.
- Add a cleanup / inspect command for stale candidate state.
- Add a migration command for renamed promoted directories.
- Decide whether to support more synced directories besides `plans/` and `notes/`.

### Nice to have

- Better status output for collision cases and custom promoted names.
- Add verbose / debug mode for observe and promotion decisions.
- Improve shell-hook installation docs.
- Add output-format tests for CLI text.

### Open questions

- Should atlas sync more than planning material?
- Should candidate state eventually key off stable `id` instead of local basename?
- Should there be a `doctor`-style command?
- Should old remote-based promoted directory names get an explicit migration path?

## Practical Commands

```bash
bun run build
bun run check
bun test
```

## Resume Checklist

1. Read `README.md` for quick usage.
2. Read `docs/project-status.md` for current state and backlog.
3. Read `src/cli.ts` and `src/repo.ts` before changing behavior.
4. Run `bun test` before and after meaningful changes.
