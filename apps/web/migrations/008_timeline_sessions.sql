-- Claude Code sessions on the timeline. `atlas timeline sync` reads the transcripts on the Mac and sends
-- facts only: never prompt text or tool output. Their day entries live in timeline_entries (session = id).
-- Design: atlas/timeline/design.html#sessions.
CREATE TABLE timeline_sessions (
  id         TEXT PRIMARY KEY,           -- the Claude Code session id
  agent      TEXT NOT NULL DEFAULT 'claude',
  title      TEXT,                       -- from the digest
  ai_title   TEXT,                       -- Claude Code's own title, set from the first prompt
  cwd        TEXT,                       -- where `claude --resume` must run
  repo_id    TEXT REFERENCES repos(id) ON DELETE SET NULL,
  started_at TEXT,
  ended_at   TEXT,
  days       INTEGER NOT NULL DEFAULT 0,
  prompts    INTEGER NOT NULL DEFAULT 0,
  commits    INTEGER NOT NULL DEFAULT 0,
  todos      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Which efforts a session worked on, and the signals that say so (JSON: ["todos", "prs", "files"]).
CREATE TABLE timeline_session_links (
  session  TEXT NOT NULL REFERENCES timeline_sessions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  signals  TEXT NOT NULL,
  PRIMARY KEY (session, group_id)
);
CREATE INDEX timeline_session_links_group ON timeline_session_links (group_id);
