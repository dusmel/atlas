-- The owner's prompts per session, as sent, after the redaction filter on the Mac drops secret-looking lines.
-- Never tool output, hook output or slash-command expansions. Design: atlas/timeline/design.html#sessions (T19).
CREATE TABLE timeline_prompts (
  session TEXT NOT NULL REFERENCES timeline_sessions(id) ON DELETE CASCADE,
  at      TEXT NOT NULL,              -- when it was sent
  day     TEXT NOT NULL,              -- the local day it belongs to, as the day entries
  text    TEXT NOT NULL,
  dropped INTEGER NOT NULL DEFAULT 0, -- lines the filter removed
  PRIMARY KEY (session, at)
);
