-- The agent session and terminal behind a change, sent by the CLI from CLAUDE_CODE_SESSION_ID
-- and HC_TERMINAL_ID. Null for the web, for scripts, and for every change made before this.
ALTER TABLE events ADD COLUMN session TEXT;
ALTER TABLE events ADD COLUMN terminal TEXT;
CREATE INDEX events_session ON events (session);
