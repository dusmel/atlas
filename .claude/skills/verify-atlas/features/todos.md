# Todos

The owner tracks todos per repo, grouped by effort, on a board at `/todos` and with `atlas todo` in a terminal. Both read and write the same server.

## Sub-features

- `todos-board` shows todos by priority row and status column.
- `todos-add-cli` adds a todo from the terminal; it shows on the board.
- `todos-state-cli` moves a todo to doing or done from the terminal.
- `todos-groups` lists groups with their linked docs.

## How to get to it (user POV)

- Open `/todos`: Board, List, Triage, Overview and Activity tabs.
- Run `atlas todo list`, `add`, `start`, `done`, `groups` in a terminal.

## Driving it with atlas-verify

Preconditions: an instance from `bun $V start`.

- **Board.** Run `bun $V shot /todos <dir>/board.png "[data-item]"`. The ARIA snapshot names `Todo`, `Doing` and `Done`, and the `P0 Urgent` row holds `Ship the v2 release notes`.
- **Add from the CLI.** Run `bun $V cli -- todo add "Verify add" --repo demo-api --priority P2 --json`. Exit 0 and the JSON has an id. Then `bun $V shot /todos <dir>/after-add.png "[data-item]"`: the card `Verify add` is in the P2 row.
- **Change state.** Run `bun $V cli -- todo start <id> --repo demo-api`, then `bun $V cli -- todo show <id> --repo demo-api --plain`. The status reads `doing`.
- **Groups.** Run `bun $V cli -- todo groups --all`. `Onboarding` lists `plan: plans/lighthouse.html`.

## Gotchas

- `--repo demo-api` is needed outside a repo whose name the server knows.
- Root `bun test` rebuilds `apps/web/dist`; restart the instance after it.
