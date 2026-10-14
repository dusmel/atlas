# Health

`GET /api/health` is the one public API route. It opens the database, runs `SELECT 1`, and reports the build version, so it answers "is this instance up, and which commit is it?".

## Sub-features

- `health-ok` returns `ok: true` and `db: "ok"` when the database opens.
- `health-version` reports the short commit the web app was built from.

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/api/health` in a browser or with `curl`. No login needed.

## Driving it with verify-atlas.sh

Preconditions:

- `$H launch` printed `ready at ...` and `$H doctor` passes.

- **Health check.** Run `curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:3917/api/health`. The body is `{"ok":true,"version":"<sha>","db":"ok"}` and the last line is `HTTP 200`.
- **Version.** Compare `version` with `git rev-parse --short HEAD`. They match right after `launch`.

## Gotchas

- The version is baked in at build time. Commits made after `launch` do not change it; launch again to pick them up.
- A 503 with `db: "error"` means the data folder could not be opened. Check `$VERIFY_DIR/server.log`.
