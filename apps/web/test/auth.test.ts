import { describe, expect, test } from "bun:test"
import {
  authenticate,
  checkPassword,
  clientIp,
  createSession,
  createToken,
  deleteSession,
  listTokens,
  LoginThrottle,
  revokeToken,
  sessionCookie,
  touchSession,
} from "../src/server/auth"
import { freshDb } from "./helpers"

const req = (headers: Record<string, string>) => new Request("http://x/api/todos", { headers })

describe("password", () => {
  test("checks against the base64 hash and fails closed", async () => {
    const hash = Buffer.from(await Bun.password.hash("right horse")).toString("base64")
    expect(await checkPassword("right horse", hash)).toBe(true)
    expect(await checkPassword("wrong", hash)).toBe(false)
    expect(await checkPassword("right horse", undefined)).toBe(false)
    expect(await checkPassword("right horse", "not-a-hash")).toBe(false)
  })
})

describe("sessions", () => {
  test("a cookie authenticates until logout", () => {
    const db = freshDb()
    const id = createSession(db)
    const cookie = sessionCookie(id).split(";")[0]!
    expect(authenticate(db, req({ cookie }))).toEqual({ kind: "session" })
    deleteSession(db, id)
    expect(authenticate(db, req({ cookie }))).toBeNull()
  })

  test("stores only a hash of the id", () => {
    const db = freshDb()
    const id = createSession(db)
    expect(JSON.stringify(db.query("SELECT * FROM sessions").all())).not.toContain(id)
  })

  test("expires after 30 days without use", () => {
    const db = freshDb()
    const id = createSession(db)
    const later = new Date(Date.now() + 31 * 24 * 3600 * 1000)
    expect(touchSession(db, id, later)).toBe(false)
  })
})

describe("tokens", () => {
  test("work as bearer until revoked", () => {
    const db = freshDb()
    const { id, token } = createToken(db, "irembo-mac")
    expect(token).toMatch(/^atl_[A-Za-z0-9_-]{43}$/)
    expect(authenticate(db, req({ authorization: `Bearer ${token}` }))).toEqual({ kind: "token", name: "irembo-mac" })
    expect(listTokens(db)[0]!.last_used_at).not.toBeNull()
    expect(revokeToken(db, id)).toBe(true)
    expect(authenticate(db, req({ authorization: `Bearer ${token}` }))).toBeNull()
  })

  test("a bad bearer does not fall back to the cookie", () => {
    const db = freshDb()
    const cookie = sessionCookie(createSession(db)).split(";")[0]!
    expect(authenticate(db, req({ cookie, authorization: "Bearer atl_nope" }))).toBeNull()
  })

  test("names are unique", () => {
    const db = freshDb()
    createToken(db, "a")
    expect(() => createToken(db, "a")).toThrow()
  })
})

describe("login throttle", () => {
  test("blocks the sixth try within 10 minutes, per IP", () => {
    const t = new LoginThrottle()
    for (let i = 0; i < 5; i++) {
      expect(t.blocked("1.1.1.1", i)).toBe(false)
      t.fail("1.1.1.1", i)
    }
    expect(t.blocked("1.1.1.1", 10)).toBe(true)
    expect(t.blocked("2.2.2.2", 10)).toBe(false)
    expect(t.blocked("1.1.1.1", 10 * 60 * 1000 + 5)).toBe(false)
  })

  test("reads the address Traefik saw", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6" }))).toBe("9.9.9.9")
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9")
  })
})
