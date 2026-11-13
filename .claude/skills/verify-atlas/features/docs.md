# Docs

Atlas serves the owner's markdown and HTML docs from a read-only folder. `/docs` lists them by repo, and `/r/<repo>/<path>` opens one in a sandboxed frame with a toolbar.

## Sub-features

- `docs-list` lists docs by repo, with a search box.
- `docs-open` opens a doc in its frame.
- `docs-group-link` a group's linked doc opens from the group.

## How to get to it (user POV)

- Open `/docs`, or press the Docs tab.
- Open `/r/demo-web/plans/lighthouse.html` directly.
- Run `atlas doc` in a terminal for the fuzzy doc finder.

## Driving it with atlas-verify

Preconditions: an instance from `bun $V start`. The seed has 4 docs under `demo-api` and `demo-web`.

- **List.** Run `bun $V shot /docs <dir>/docs.png "[data-repo]"`. The ARIA snapshot has the search box `Search the docs` and the repos `demo-api` and `demo-web`.
- **Open.** Run `bun $V shot /r/demo-web/plans/lighthouse.html <dir>/doc.png "iframe"`. The screenshot shows the doc's title in the toolbar and its body in the frame.

## Gotchas

- The doc body is in a sandboxed iframe, so the ARIA snapshot of the page does not include it. Use a Playwright spec with `docFrame()` from `e2e/helpers.ts` to read inside it.
