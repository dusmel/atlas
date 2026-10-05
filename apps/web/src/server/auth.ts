import type { Database } from "bun:sqlite"
import { now } from "./db"

export const SESSION_COOKIE = "atlas_session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

export type Auth = { kind: "session" } | { kind: "token"; name: string }

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex")
const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

// The hash is stored base64-encoded because Docker Compose reads `$` in env values as a variable.
export async function checkPassword(password: string, hashB64 = process.env.ATLAS_PASSWORD_HASH_B64): Promise<boolean> {
  if (!hashB64 || !password) return false
  try {
    return await Bun.password.verify(password, Buffer.from(hashB64, "base64").toString())
  } catch {
    return false
  }
}

export function createSession(db: Database): string {
  const id = randomId()
  const at = now()
  db.run("INSERT INTO sessions (id_hash, created_at, last_seen_at) VALUES (?, ?, ?)", [sha256(id), at, at])
  return id
}

// A session lasts 30 days from its last use.
export function touchSession(db: Database, id: string, at = new Date()): boolean {
  const cutoff = new Date(at.getTime() - SESSION_MAX_AGE * 1000).toISOString()
  const res = db.run("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND last_seen_at > ?", [
    at.toISOString(),
    sha256(id),
    cutoff,
  ])
  return res.changes === 1
}

export function deleteSession(db: Database, id: string): void {
  db.run("DELETE FROM sessions WHERE id_hash = ?", [sha256(id)])
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(/;\s*/)) {
    const eq = part.indexOf("=")
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1)
  }
  return null
}

export type TokenRow = { id: number; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export function createToken(db: Database, name: string): { id: number; token: string } {
  const token = `atl_${randomId()}`
  const row = db
    .query<{ id: number }, [string, string, string]>("INSERT INTO api_tokens (name, hash, created_at) VALUES (?, ?, ?) RETURNING id")
    .get(name, sha256(token), now())
  return { id: row!.id, token }
}

export function listTokens(db: Database): TokenRow[] {
  return db.query<TokenRow, []>("SELECT id, name, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY id").all()
}

export function revokeToken(db: Database, id: number): boolean {
  return db.run("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now(), id]).changes === 1
}

export function findToken(db: Database, token: string): string | null {
  const row = db
    .query<{ id: number; name: string }, [string]>("SELECT id, name FROM api_tokens WHERE hash = ? AND revoked_at IS NULL")
    .get(sha256(token))
  if (!row) return null
  db.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [now(), row.id])
  return row.name
}

// A bad bearer token fails outright rather than falling back to the cookie.
export function authenticate(db: Database, request: Request): Auth | null {
  const header = request.headers.get("authorization")
  if (header) {
    const match = /^Bearer (atl_[A-Za-z0-9_-]+)$/.exec(header)
    const name = match ? findToken(db, match[1]!) : null
    return name ? { kind: "token", name } : null
  }
  const session = readCookie(request, SESSION_COOKIE)
  return session && touchSession(db, session) ? { kind: "session" } : null
}

// Who wrote an event: the browser, or a token, named after its device when the CLI says which.
/** Where a change came from (actor) and who made it (author). */
export type Who = { actor: string; author: string }

// "agent" is the filter for every agent and "import" is the importer, so neither can be claimed.
const AUTHOR = /^(?!agent$|import$)[a-z0-9][a-z0-9._-]{0,31}$/

export function whoOf(auth: Auth, request: Request): Who {
  if (auth.kind === "session") return { actor: "web", author: "me" }
  const device = request.headers.get("x-atlas-device")
  const author = request.headers.get("x-atlas-author") ?? ""
  return {
    actor: device && /^[\w.-]{1,64}$/.test(device) ? `cli:${device}` : `token:${auth.name}`,
    author: AUTHOR.test(author) ? author : "script",
  }
}

// Traefik sets X-Real-Ip to the address it saw, overwriting whatever the client sent.
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "local"
}

export class LoginThrottle {
  private fails = new Map<string, number[]>()
  constructor(
    private limit = 5,
    private windowMs = 10 * 60 * 1000,
  ) {}

  private recent(ip: string, at: number): number[] {
    const list = (this.fails.get(ip) ?? []).filter((t) => at - t < this.windowMs)
    if (list.length) this.fails.set(ip, list)
    else this.fails.delete(ip)
    return list
  }

  // Records the attempt before the caller awaits anything, so parallel requests can't all
  // pass. Every call drops expired IPs, so the map only holds the last window's failures.
  attempt(ip: string, at = Date.now()): boolean {
    for (const other of this.fails.keys()) this.recent(other, at)
    const list = this.fails.get(ip) ?? []
    if (list.length >= this.limit) return false
    this.fails.set(ip, [...list, at])
    return true
  }

  get size(): number {
    return this.fails.size
  }

  clear(ip: string): void {
    this.fails.delete(ip)
  }
}

export const loginThrottle = new LoginThrottle()
