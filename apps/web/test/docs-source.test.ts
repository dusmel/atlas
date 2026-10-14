import { describe, expect, test } from "bun:test"
import { megaState, parseMegaSync } from "../src/server/docs-source"

// The shape MEGAcmd printed on the box on 2026-10-12.
const report = (...rows: string[]) => ["LOCALPATH|RUN_STATE|STATUS|ERROR", ...rows].join("\n") + "\n"
const now = Date.UTC(2026, 9, 12, 12, 0)
const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()

describe("MEGA status", () => {
  test("reads the pairs from mega-sync's table, and nothing from an error", () => {
    expect(parseMegaSync(report("/data/docs|Running|Synced|NO", "/data/backups|Running|Syncing|NO"))).toEqual([
      { path: "/data/docs", run: "Running", status: "Synced", error: "NO" },
      { path: "/data/backups", run: "Running", status: "Syncing", error: "NO" },
    ])
    expect(parseMegaSync("[API:err] Not logged in.\n")).toBeNull()
  })

  test("is ok when every pair is synced and syncing while one is not", () => {
    expect(megaState(report("/data/docs|Running|Synced|NO", "/data/backups|Running|Synced|NO"), at(0), at(1), now)).toMatchObject({ state: "ok", last_pull: at(1) })
    expect(megaState(report("/data/docs|Running|Syncing|NO", "/data/backups|Running|Synced|NO"), at(0), at(5), now).state).toBe("syncing")
  })

  test("fails on an error, a stopped pair, a stale report or no pairs, and is unknown with no report", () => {
    expect(megaState(report("/data/docs|Running|Synced|STORAGE_OVERQUOTA"), at(0), null, now)).toMatchObject({ state: "failed", detail: "/data/docs: Running, error STORAGE_OVERQUOTA" })
    expect(megaState(report("/data/docs|Suspended|Synced|NO"), at(0), null, now).state).toBe("failed")
    expect(megaState(report("/data/docs|Running|Synced|NO"), at(4), at(4), now)).toMatchObject({ state: "failed", detail: "MEGAcmd has not reported for over 3 minutes" })
    expect(megaState(report(), at(0), null, now).state).toBe("failed")
    expect(megaState("[API:err] Not logged in.\n", at(0), null, now)).toMatchObject({ state: "failed", detail: "[API:err] Not logged in." })
    expect(megaState(null, null, null, now).state).toBe("unknown")
  })
})
