# atlas

Sync notes and context from active git repos to a centralized store. 

This includes features docs, implementation plans, how things work, current todos...

- Auto-discovers repos I actually work in
- Scores engagement via zsh hooks; promotes repos when they cross a threshold
- Moves repo-root `plans/` and `notes/` into `atlas/` on promotion
- Handles name collisions interactively

---

## Quick commands

| command | purpose |
|---------|---------|
| `atlas status` | untracked / candidate (score) / promoted |
| `atlas ensure` | create atlas dir + symlink (idempotent) |
| `atlas promote` | force-promote + clear candidate state |
| `atlas observe --cmd "..." --exit 0` | score a command (called by zsh hooks) |
| `atlas open` | pick an atlas HTML file to open (default `index.html`) |
| `atlas todo list` / `add` / `move` / ... | todos on `atlas.hadadus.me` for the current repo (`atlas todo --help`) |
| `atlas completion zsh` | the zsh completion script; install with `atlas completion zsh > ~/.zsh/completions/_atlas` and put that folder on `fpath` |

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
│   │   ├── plans/           # moved from repo root on promotion
│   │   └── notes/           # moved from repo root on promotion
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
| `ATLAS_URL`, `ATLAS_TOKEN` | from `~/.config/atlas/config.json` | server and token for `atlas todo` |
| `ATLAS_AUTHOR` | the agent, else `me` at a terminal, else `script` | who `atlas todo` records as the author of a change; set it for agents the CLI cannot detect |

---

## Build / test

```bash
# compile the CLI to ~/.local/bin/atlas, then build the web app
bun run build
bun run build:cli          # CLI only

# typecheck the CLI, packages and web app
bun run check

# run every workspace's tests
bun test
```

---

## Web app

The repo is bun workspaces. `apps/cli` is the `atlas` CLI above. `apps/web` is the Atlas web app (TanStack Start, shadcn, Tailwind, on Bun), and it also serves the API the CLI will call. `packages/todos` and `packages/indexer` hold code shared by the CLI and the server. The plan lives in `atlas/atlas-web-v1-spec.html`.

```bash
bun run dev:web                        # dev server on http://localhost:3000
curl -s localhost:3000/api/health      # {"ok":true,"version":"<git sha>"}

bun run build:web                      # production build in apps/web/dist
bun --cwd apps/web run start           # serve it (PORT defaults to 3000)

docker build -f apps/web/Dockerfile --build-arg SOURCE_COMMIT=$(git rev-parse --short HEAD) -t atlas-web .
docker run --rm -p 3000:3000 atlas-web
```

---

## Maintenance

Promoted names are reconciled with a standalone script (kept out of the CLI on purpose):

```bash
bun run migrate            # dry run
bun run migrate -- --apply    # apply renames, fix meta.json + symlinks
bun run migrate -- --apply --repo PATH  # single repo
```

It only renames old remote-based dirs or changed identities, keeps custom names, and never deletes (missing roots report as `stale`).

---

## Notes

- Symlink is always named `atlas` (not the project name).
- On promotion, repo-root `plans/` and `notes/` are moved into atlas. If a real `atlas/` directory already exists in the repo, its `plans/` and `notes/` are migrated before the directory is replaced with the symlink.
- `meta.json` stores a stable `id` (derived from remote URL or path hash) for disambiguation across renames.
