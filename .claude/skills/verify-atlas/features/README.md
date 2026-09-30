# Atlas verification map

This folder is the maintained source for verifying what Atlas web users can do. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run everything from the repo root with `H=.claude/skills/verify-atlas/verify-atlas.sh`.
- Launch with `$H launch` and require `$H doctor` to pass.
- The instance starts empty: no todos, one repo named `personal`, no tokens.
- Never drive an instance this skill did not start, and never `atlas.hadadus.me`.

## Driving conventions

- Treat every command as literal.
- Browser pages are checked with `$H shot`. It cannot click, so UI actions go through the same HTTP call the page makes.
- Terminal actions go through `$H cli todo ...` from the repo root.
- Every change gets a read-only second view through `$H api GET ...` or a screenshot.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen.
- CLI proof includes the command, stdout, and exit code.
- Record the feature ID and entry point with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-atlas.sh`, and `Gotchas`.

## Features

- [Health](./health.md) covers the public health check and the build version.
- [Login and session](./login.md) covers the password page, the session cookie, the redirect for logged-out pages, and logout.
- [API tokens](./api-tokens.md) covers creating, listing, using, and revoking tokens from Settings.
- [Todos](./todos.md) covers adding, listing, moving, and finishing todos from the CLI and the API.
