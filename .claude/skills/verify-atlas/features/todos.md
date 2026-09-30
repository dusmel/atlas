# Todos

Todos belong to a repo, sit in a priority lane (P0 to P3, Low, or inbox), and move through todo, doing, and done. The `atlas todo` CLI is the main entry point; it calls the same `/api/todos` routes the board will use.

## Sub-features

- `todo-add` creates a todo in the current repo, creating the repo on first use.
- `todo-list` lists todos by status, priority, or group.
- `todo-move` reorders a todo and can change its status or priority in the same call.
- `todo-done` marks a todo done.
- `todo-api` reads the same todos over `GET /api/todos`.
- `todo-usage` rejects a bad command with exit code 2 and the usage line.

## How to get to it (user POV)

- Run `atlas todo add "title"` inside a promoted repo.
- Run `atlas todo list`, `move`, `start`, `done`, or `archive` with an item id.
- Call `/api/todos` with a bearer token.

## Driving it with verify-atlas.sh

Preconditions:

- `$H token` succeeded. Run every command from the repo root, so the CLI resolves the repo as `atlas`.

- **Add.** Run `$H cli todo add "verify: first card" --priority P1; echo "exit=$?"`. Prints `P1  #1  todo   atlas  verify: first card`, then `exit=0`. Add a second card the same way; it gets `#2`.
- **Move.** Run `$H cli todo move 2 --top --status doing`. Prints `P1  #2  doing  atlas  verify: second card`.
- **Done.** Run `$H cli todo done 1`. Prints `P1  #1  done   atlas  verify: first card`.
- **List.** Run `$H cli todo list --status todo,doing,done`. Prints `#2` as doing, then `#1` as done.
- **API read-back.** Run `$H api GET '/api/todos?repo=atlas&status=doing,done' | sed '$d' | jq -c '.[] | {id,title,status}'`. Shows both todos with the same statuses the CLI printed.
- **Usage error.** Run `$H cli todo add ""; echo "exit=$?"`. Prints `Usage: atlas todo add "title"`, then `exit=2`.

## Gotchas

- `--repo NAME` sends a bare name, which must already exist on the server. On a fresh instance it fails with `No repo NAME`. Run from the repo root instead, or use `--personal`.
- `$H api` prints `HTTP <code>` as its last line. Strip it with `sed '$d'` before piping to `jq`.
- The CLI reads `~/.config/atlas/config.json` when `ATLAS_URL` is unset. Always go through `$H cli`, which sets it, so a run never writes to the real server.
