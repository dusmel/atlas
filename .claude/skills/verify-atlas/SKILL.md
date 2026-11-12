---
name: verify-atlas
description: Prove Atlas behaviour the way the owner meets it, on a throwaway seeded server. Drives the web app (todos board, docs, timeline) in Chrome and the `atlas` CLI against the same server, and saves screenshots, ARIA snapshots and CLI output as evidence. Use before calling an Atlas change done, or when a phase plan asks for verify-atlas.
---

# verify-atlas

Atlas is a Bun web app (`apps/web`, TanStack Start, SQLite) and a CLI (`apps/cli`) that talks to it over HTTP with a token. This skill starts its own instance of the web app on made-up data, so it never touches the owner's real server or the review servers on 3100 and 3101.

Everything goes through one helper, run from the repo root:

```sh
export PATH=~/.bun/bin:$PATH
V=.claude/skills/verify-atlas/atlas-verify.ts
```

## Launch

```sh
bun $V start            # builds apps/web, serves seeded data on :4400
bun $V start 4410       # another port
bun $V start --no-build # reuse apps/web/dist when nothing changed since the last build
```

`start` refuses a taken port and refuses to start a second instance. It runs `apps/web/e2e/serve.ts`, the same seeded server Playwright uses, waits until `/api/health` reports 4 docs, adds an API token to the instance's database, and writes the URL, token, data folder and pid to `.cache/verify-atlas/instance.json`. It prints `ready http://localhost:4400 pid <pid> data <dir>`. The server log is `.cache/verify-atlas/server.log`.

The web password is `e2e-only-password`. The seed is in `apps/web/e2e/seed.ts`: repos `demo-api` and `demo-web`, groups `Search quality`, `Release prep`, `Onboarding`, and 22 todos.

## Doctor

```sh
bun $V doctor
```

Prints JSON and exits 1 unless all of these hold: the pid is alive, it owns the port, `/api/health` says `ok`, and the token gets a 200 from `/api/todos`. `health.version` is the git commit the build came from. Run it first whenever something looks off.

## Drive

- **CLI.** `bun $V cli -- <atlas args>` runs `apps/cli/index.ts` from this checkout with `ATLAS_URL` and `ATLAS_TOKEN` set to the instance, and `ATLAS_AUTHOR=verify`. Example: `bun $V cli -- todo list --group "Release prep" --plain`.
- **Web.** `bun $V shot <path> <out.png> [selector]` logs in, opens the path, waits for the selector when given, then saves a full-page screenshot and `<out>.aria.txt`, an ARIA snapshot of the page. Example: `bun $V shot /todos evidence/board.png "[data-item]"`.
- **Clicks and typing.** For anything beyond a screenshot, write a Playwright spec in `apps/web/e2e/` and run it with `cd apps/web && bunx playwright test <file> --max-failures=1`. Its config builds and seeds its own server on port 4317. Use the helpers in `apps/web/e2e/helpers.ts` (`login`, `api`, `openBoard`, `card`).
- **API.** `curl -s -H "authorization: Bearer $(jq -r .token .cache/verify-atlas/instance.json)" localhost:4400/api/todos`.

Stable handles: `[data-item="<id>"]` for todo cards, `[data-cell="<key>"]` for board cells, ARIA labels such as `Search the docs`, `Repos`, `Totals`. The feature map lists more for each feature.

## Evidence

Save proof under the effort's evidence folder, `atlas/<effort>/evidence/<phase>/`, never under `.cache`. A proof:

- drives the real user path: the page or the CLI command, not a test-only endpoint or a direct database write
- captures the action and the state after it: the CLI command with its output and exit code, or the screenshot with its ARIA snapshot
- checks the side effect in a second, read-only view, for example `cli -- todo show <id>` after a change made in the web app

## Cleanup

```sh
bun $V stop
```

Stops the pid that `start` recorded, deletes the instance's temp data folder, and removes `instance.json`. It never kills by process name and never touches files outside the temp folder, so evidence stays where you saved it. After a failed run, still run `stop`.

## Rebuild trap

`bun run build`, `bunx playwright test` and root `bun test` all rebuild `apps/web/dist`. A running instance keeps the old build in memory and serves pages that point at deleted files, so pages hang. After any of them, `stop` and `start --no-build` again.

## Feature map

[features/README.md](features/README.md) lists each feature with its entry points and what proves it.
