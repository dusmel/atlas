-- The docs the index saw last, so changes made while the server was down still show up after a restart.
CREATE TABLE doc_files (
  repo  TEXT NOT NULL,
  path  TEXT NOT NULL,
  kind  TEXT NOT NULL,
  title TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size  INTEGER NOT NULL,
  PRIMARY KEY (repo, path)
);

-- Doc changes for the Docs page's Activity view. Names and times only: the text stays out of backups.
CREATE TABLE doc_events (
  id     INTEGER PRIMARY KEY,
  at     TEXT NOT NULL,
  change TEXT NOT NULL CHECK (change IN ('added','changed','removed')),
  repo   TEXT NOT NULL,
  path   TEXT NOT NULL,
  folder TEXT NOT NULL,
  kind   TEXT NOT NULL,
  title  TEXT NOT NULL
);
CREATE INDEX doc_events_at ON doc_events (at);
