-- Timeline entries for an effort (a todo group) or a Claude Code session. `atlas timeline sync` writes them
-- from git, run.md, timeline.md and the todos; the web only reads them. Design: atlas/timeline/design.html.
CREATE TABLE timeline_entries (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  session    TEXT,
  entry      TEXT NOT NULL,            -- the validation's name (phase-1, polish), or a date for day entries
  position   INTEGER NOT NULL,         -- order on the rail, oldest first
  state      TEXT NOT NULL CHECK (state IN ('done', 'doing', 'todo', 'parked')),
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '', -- from timeline.md; a sync that sends no note keeps this one
  note_state TEXT NOT NULL DEFAULT 'none' CHECK (note_state IN ('none', 'draft', 'written')),
  merged     INTEGER NOT NULL DEFAULT 0,
  lines      TEXT NOT NULL DEFAULT '[]', -- JSON: [{ day, text, source, ref, kind }]
  started_at TEXT,
  ended_at   TEXT,
  updated_at TEXT NOT NULL,
  CHECK ((group_id IS NULL) <> (session IS NULL))
);
CREATE UNIQUE INDEX timeline_group_entry ON timeline_entries (group_id, entry) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX timeline_session_entry ON timeline_entries (session, entry) WHERE session IS NOT NULL;

-- An effort's branches, as a git pattern such as 'v1/*'. The repo is the group's own repo_id.
ALTER TABLE groups ADD COLUMN branches TEXT;
