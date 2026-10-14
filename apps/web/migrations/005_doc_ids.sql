-- A doc's fixed id (the doc contract, spec section 9), so shares and group docs survive a rename or a move.
-- The path stays the fallback for docs with no id.
ALTER TABLE shares ADD COLUMN doc_id TEXT;
ALTER TABLE group_docs ADD COLUMN doc_id TEXT;

-- Every path a doc with an id has had. /r/<old path> redirects to where that id is now.
CREATE TABLE doc_paths (
  repo      TEXT NOT NULL,
  path      TEXT NOT NULL,
  doc_id    TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (repo, path)
);
