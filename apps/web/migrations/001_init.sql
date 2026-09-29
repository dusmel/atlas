CREATE TABLE repos (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE groups (
  id         INTEGER PRIMARY KEY,
  repo_id    TEXT NOT NULL REFERENCES repos(id),
  name       TEXT NOT NULL,
  doc_path   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (repo_id, name)
);

CREATE TABLE imports (
  id       INTEGER PRIMARY KEY,
  repo_id  TEXT NOT NULL REFERENCES repos(id),
  path     TEXT NOT NULL,
  sha256   TEXT NOT NULL,
  original TEXT NOT NULL,
  report   TEXT NOT NULL,
  at       TEXT NOT NULL,
  UNIQUE (repo_id, path)
);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     TEXT NOT NULL REFERENCES repos(id),
  group_id    INTEGER REFERENCES groups(id),
  parent_id   INTEGER REFERENCES items(id),
  section     TEXT,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority    TEXT CHECK (priority IN ('P0','P1','P2','P3')),
  rank        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  done_at     TEXT,
  archived_at TEXT,
  import_id   INTEGER REFERENCES imports(id)
);
CREATE INDEX items_lane ON items (priority, status, rank) WHERE archived_at IS NULL;
CREATE INDEX items_repo ON items (repo_id) WHERE archived_at IS NULL;

CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  item_id INTEGER,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  data    TEXT NOT NULL,
  at      TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  hash         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE shares (
  token      TEXT PRIMARY KEY,
  repo_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

INSERT INTO repos (id, name, updated_at) VALUES ('_personal', 'personal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
