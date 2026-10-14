# API tokens

The Settings page creates one bearer token per device or agent. A token is shown once. The CLI and scripts send it as `Authorization: Bearer <token>`. Tokens are managed only from a browser session, never with another token.

## Sub-features

- `token-create` makes a token with a unique name and returns it once.
- `token-list` shows each token's name, creation date, last use, and revoked state.
- `token-use` authenticates API calls as that token.
- `token-session-only` refuses token management over a bearer token.
- `token-revoke` stops a token from working.

## How to get to it (user POV)

- Open `/settings`, type a name, and choose **Create token**.
- Choose **Revoke** next to a token and confirm.

## Driving it with verify-atlas.sh

Preconditions:

- `$H login` succeeded. `U=http://127.0.0.1:3917`.

- **Create.** Run `$H token`. It makes the same `POST /api/tokens` call the Settings form makes and prints `token saved to $VERIFY_DIR/token`.
- **List.** Run `curl -s -b $VERIFY_DIR/cookies $U/api/tokens | jq -c '[.[] | {id,name,revoked_at}]'`. Shows the new token with `revoked_at: null`.
- **Use.** Run `$H api GET /api/repos`. Ends with `HTTP 200`.
- **Session only.** Run `$H api GET /api/tokens`. Body has `"code":"session_only"`, then `HTTP 403`.
- **Revoke.** Run `curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b $VERIFY_DIR/cookies -H 'x-atlas: 1' -X DELETE $U/api/tokens/<id>`. Prints `HTTP 204`. Then `$H api GET /api/todos` has `"code":"unauthorized"` and `HTTP 401`.
- **Proof.** Run `$H shot /settings artifacts/settings.png` and `$H shot /settings artifacts/settings-phone.png 390`. The token appears under **API tokens** with a **Revoke** button, and the phone shot's `scrollWidth` is 390.

## Gotchas

- Token names must match `^[A-Za-z0-9._-]{1,64}$` and be unique. `$H token` adds a timestamp for that reason.
- After a revoke, `$VERIFY_DIR/token` still holds the dead token. Delete that file or run `$H token` again before more `api` or `cli` calls.
- Never copy `$VERIFY_DIR/token` into evidence.
