import { describe, expect, test } from "bun:test"
import { docPrefix } from "../src/timeline-sessions"

const plan = (path: string) => docPrefix({ docs: [{ label: "plan", path }] } as never)

describe("docPrefix", () => {
  test("a plan in the docs root shares the folder, so only files named like it count", () => {
    expect(plan("object-storage-plan.html")).toBe("object-storage-")
    expect(plan("atlas-web-v1-overview.html")).toBe("atlas-web-v1-")
    expect(plan("telephony-architecture.html")).toBe("telephony-")
    expect(plan("overview.html")).toBe("overview")
  })

  test("a plan in its own folder, or one called plan.html, takes the whole folder", () => {
    expect(plan("voice-200-users/report.html")).toBeNull()
    expect(plan("timeline/plan.html")).toBeNull()
    expect(plan("plan.html")).toBeNull()
    expect(docPrefix({ docs: [] } as never)).toBeNull()
  })
})
