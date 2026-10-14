-- A group links several docs by label, such as plan, overview and design (D21). Paths are relative to the repo's atlas/.
CREATE TABLE group_docs (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  path     TEXT NOT NULL,
  PRIMARY KEY (group_id, label)
);

-- The one doc a group had was its plan, which is what `atlas todo show` called it.
INSERT INTO group_docs (group_id, label, path) SELECT id, 'plan', doc_path FROM groups WHERE doc_path IS NOT NULL AND doc_path != '';
ALTER TABLE groups DROP COLUMN doc_path;
