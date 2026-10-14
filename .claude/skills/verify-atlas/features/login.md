# Login and session

Atlas has one password. `/login` checks it against `ATLAS_PASSWORD_HASH_B64` and sets an `atlas_session` cookie that lasts 30 days from its last use. Logged-out pages redirect to `/login`, and logged-out API calls get a 401.

## Sub-features

- `login-ok` sets the session cookie and redirects to `/`.
- `login-wrong` redirects back to `/login?error=1`, and the page shows "Wrong password."
- `login-gate-page` redirects a logged-out page request to `/login`.
- `login-gate-api` answers a logged-out API request with 401 `unauthorized`.
- `login-header` refuses a cookie-authenticated API change that lacks `X-Atlas: 1`.
- `logout` deletes the session and clears the cookie.

## How to get to it (user POV)

- Open any page while logged out, such as `/settings`, and get sent to the login form.
- Submit the password field on `/login`.
- Log out with the `POST /logout` form.

## Driving it with verify-atlas.sh

Preconditions:

- A fresh instance from `$H launch`. The password is `verify-atlas-only`.
- `U=http://127.0.0.1:3917`.

- **Gate a page.** Run `curl -s -o /dev/null -w 'HTTP %{http_code} -> %{redirect_url}\n' $U/settings`. Prints `HTTP 302 -> .../login`.
- **Gate the API.** Run `curl -s -w '\nHTTP %{http_code}\n' $U/api/todos`. Body has `"code":"unauthorized"`, then `HTTP 401`.
- **Wrong password.** Run `curl -s -o /dev/null -w 'HTTP %{http_code} -> %{redirect_url}\n' -X POST $U/login --data-urlencode password=nope`. Prints `HTTP 303 -> .../login?error=1`.
- **Log in.** Run `$H login`. Prints `login: HTTP 303 -> .../`.
- **Logged-in page.** Run `curl -s -o /dev/null -b $VERIFY_DIR/cookies -w 'HTTP %{http_code}\n' $U/settings`. Prints `HTTP 200`.
- **Missing header.** Run `curl -s -b $VERIFY_DIR/cookies -H 'content-type: application/json' -d '{"name":"x"}' -w '\nHTTP %{http_code}\n' $U/api/tokens`. Body has `"code":"missing_header"`, then `HTTP 403`.
- **Log out.** Run `curl -s -o /dev/null -b $VERIFY_DIR/cookies -X POST -w 'HTTP %{http_code} -> %{redirect_url}\n' $U/logout`, then the logged-in page check again. The first prints `HTTP 303 -> .../login`, the second `HTTP 302 -> .../login`.
- **Proof.** Run `$H shot /login artifacts/login.png` and `$H shot / artifacts/home.png`. The first shows the password form, the second the Atlas home page with a Settings link.

## Gotchas

- The cookie is `Secure`. curl still sends it to `127.0.0.1`, but a browser pointed at a LAN address over plain HTTP will not.
- `/login` shows the password form even to a logged-in session, so `$H shot /login` works before or after `$H login`. `shot` itself always logs in first.
- Logging out deletes the session row, so the saved cookie stops working. Run `$H login` again afterwards.
