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

- On promotion, repo-root `plans/` and `notes/` are moved into the promoted atlas dir.
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
- Add `atlas open` to open the current repo's `atlas/index.html` in the browser.
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

## Raw Next Ideas

These are intentionally not implementation-ready yet. They should be aligned and refined before they move into the real backlog or active TODO.

### Index and search

- Atlas itself should have an index with all stored files, and it should be truly searchable, not just client-side filtered.
- `sem` may be a good candidate to power semantic search for this.

### Local browser access

- Find a way to map the generated atlas index locally so it is easy to open in a browser.
- Desired feel: something like `local:atlas`.
- Need to check feasibility and what the cleanest local URL / alias mechanism would be.

### App layer

- Atlas could also exist as a React + TanStack app.
- That app should also render markdown content directly.
- This should be treated as an additional experience layer, not the primary storage contract.

### Deployment

- Deploy Atlas on a personal domain.
- Likely path: Coolify connected to the git repo.
- Auto-deploy a few times a day, with manual deploys still available.

### Principle to preserve

- Individual files should still contain everything needed to open and use them directly.
- The Atlas app should be an enhancement for browsing, search, and experience — not a dependency for the content to remain usable.

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
