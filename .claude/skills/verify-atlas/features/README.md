# Atlas verification map

The maintained list of what the owner can do in Atlas, and how to prove each one. Read it before driving the app, then follow the feature file.

## Baseline

- An instance from `bun $V start`, healthy by `bun $V doctor`.
- Seeded data from `apps/web/e2e/seed.ts`. Each Playwright spec works on its own titles, so do the same: make your own todo rather than change a seeded one other specs read.
- Never drive the owner's server at atlas.hadadus.me or the review servers on 3100 and 3101.

## Proof

- Web proof is a screenshot and its ARIA snapshot from `bun $V shot`.
- CLI proof is the command, its output and its exit code.
- A change proves itself in a second view: a change made in the web app is read back with the CLI, and the other way round.
- Report a path you could not reach, with the command you tried. Do not count it as proven through another path.

## Features

- [Todos](./todos.md): the board and list on `/todos`, and `atlas todo` in the terminal.
- [Docs](./docs.md): the docs list on `/docs` and a doc opened at `/r/<repo>/<path>`.
- [Timeline](./timeline.md): `/timeline?group=` and `atlas timeline`.
