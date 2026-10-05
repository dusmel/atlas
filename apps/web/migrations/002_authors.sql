-- Who made a change (me, an agent's name, script, import), kept apart from where it came from (actor).
ALTER TABLE events ADD COLUMN author TEXT;
ALTER TABLE items ADD COLUMN created_by TEXT;

-- Only these two are known for old rows; CLI changes before this could be me or an agent.
UPDATE events SET author = 'import' WHERE actor = 'import';
UPDATE events SET author = 'me' WHERE actor = 'web';
UPDATE items SET created_by = (SELECT author FROM events WHERE events.item_id = items.id ORDER BY events.id LIMIT 1);
