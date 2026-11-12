# Timeline

The timeline shows what got done, what is in progress and what comes next for an effort, read top to bottom, with a sidebar of efforts by repo. Design: `atlas/timeline/design.html`.

## Sub-features

- `timeline-effort` the rail for one effort at `/timeline?group=<name>`.
- `timeline-compact` Compact folds closed entries to one line and keeps now open.
- `timeline-sidebar` efforts by repo with phase bars, the Active, Neglected, All filter and the Bars or List toggle.
- `timeline-sync-cli` `atlas timeline sync` reads git, `run.md`, `timeline.md` and the todo group, and posts entries.
- `timeline-show-cli` `atlas timeline show <group>` prints the entries as markdown.

## How to get to it (user POV)

- Open `/timeline?group=<name>`, or press Timeline on a group's doc.
- Run `atlas timeline sync`, `show`, `link` and `note` in a terminal.

## Driving it with atlas-verify

Preconditions: an instance from `bun $V start`. Link a group with `bun $V cli -- timeline link "Release prep" --repo demo-api --branches 'release/*'` and post entries with `bun $V cli -- timeline sync` from a fixture repo before the page has anything to show.

- **Effort page.** Run `bun $V shot "/timeline?group=Release%20prep" <dir>/effort.png "[data-entry]"`. The ARIA snapshot lists the entries oldest first and one entry marked as now.
- **Show.** Run `bun $V cli -- timeline show "Release prep" --repo demo-api`. Exit 0 and the same entries as markdown.

## Gotchas

- The page reads the server's table, not the files. An entry shows only after a sync posts it.
