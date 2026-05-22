# atlas

Sync notes and context from active git repos to a centralized store. 

This includes features docs, implementation plans, how things work, current todos...

- Auto-discovers repos I actually work in
- Scores engagement via zsh hooks; promotes repos when they cross a threshold
- Copies `plans/` and `notes/` into `atlas/` on promotion
- Handles name collisions interactively

---

## Quick commands

| command | purpose |
|---------|---------|
| `atlas status` | untracked / candidate (score) / promoted |
| `atlas ensure` | create atlas dir + symlink (idempotent) |
| `atlas promote` | force-promote + clear candidate state |
| `atlas observe --cmd "..." --exit 0` | score a command (called by zsh hooks) |

---

## How promotion works

Repos start **untracked** and become **candidates** when I run scored commands inside them.

### Scoring

| points | triggers |
|--------|----------|
| 0 | `git help`, `git version`, `git rev-parse`, `ls`, `cd` … |
| 1 | `git status`, `git log`, `git branch`, `git show`, `nvim`, `code`, `zed` … |
| 2 | `git diff`, `git switch`, `git checkout`, `git pull`, `git fetch` |
| 4 | `git add`, `git commit`, `git merge`, `git rebase`, `git stash`, `git cherry-pick` |

Aliases are resolved (`gst` → `git status`, `ga` → `git add`, etc.).

### Threshold

Default **4**. When a candidate's score crosses the threshold, it is **auto-promoted**.

```
untracked → candidate (scoring) → promoted (atlas linked)
```

### Stale reset

If no activity for **48 hours**, the score resets to zero on the next observed command.

---

## Directory layout

```
~/MEGA/Documents/atlas
├── repos/
│   ├── sem/                 # promoted repo (local basename)
│   │   ├── meta.json        # repoId, id, repoRoot, remoteUrl
│   │   ├── plans/           # copied from repo root on promotion
│   │   └── notes/           # copied from repo root on promotion
│   └── sem-37ef/            # disambiguated name when collision
└── state/
    └── candidates/
        └── sem.json         # candidate scoring state
```

In a promoted repo root:

```
my-repo/
├── atlas → ~/MEGA/Documents/atlas/repos/my-repo   # symlink
└── .git/info/exclude                                 # "atlas" ignored
```

---

## Name collisions

If two different repos share the same local basename (e.g. both named `sem`):

- `atlas promote` (manual) → prompts to accept suggested name or type a custom one
- Hook auto-promotion → uses suggested name headlessly (`sem-37ef`)

The unique `id` in `meta.json` ensures existing promoted dirs are found even under custom names.

---

## Zsh integration

Two hooks live in `~/.zsh/hooks/atlas.zsh`:

- **`atlas_preexec`** — fast string check on every command; no-op for non-scored commands
- **`atlas_precmd`** — runs `atlas observe --cmd "..." --exit $?` in background (`&!`)

`.zshrc` sources the hooks. The heavy work happens in `precmd`, not the hot-path `preexec`.

---

## Environment variables

| var | default | effect |
|-----|---------|--------|
| `ATLAS_ROOT` | `~/MEGA/Documents/atlas` | base storage directory |
| `ATLAS_THRESHOLD` | `4` | score needed for auto-promotion |

---

## Build / test

```bash
# compile to ~/.local/bin/atlas
bun run build

# typecheck
bun run check

# run tests
bun test
```

---

## Notes

- Symlink is always named `atlas` (not the project name).
- On promotion, if a real `atlas/` directory already exists in the repo, its `plans/` and `notes/` are migrated before the directory is replaced with the symlink.
- `meta.json` stores a stable `id` (derived from remote URL or path hash) for disambiguation across renames.
