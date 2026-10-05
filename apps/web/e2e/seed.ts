// Made-up data for the Playwright tests. Each test works on its own titles, so test order doesn't matter.
export const PASSWORD = "e2e-only-password"

const api = { id: "github.com-demo-api", name: "demo-api" }
const web = { id: "github.com-demo-web", name: "demo-web" }

const item = (repo: typeof api, title: string, priority: string | null, status = "todo", extra: Record<string, unknown> = {}) => ({ repo, title, priority, status, ...extra })

export const SEED = {
  groups: [
    { repo: api, name: "Search quality" },
    { repo: api, name: "Release prep" },
    { repo: web, name: "Onboarding" },
  ],
  items: [
    item(api, "Inbox idea about caching", null),
    item(web, "Inbox idea about the signup copy", null),
    item(api, "Ship the `v2` release notes", "P0", "doing", { group: "Release prep" }),
    item(api, "Drag me to P1 doing", "P2"),
    item(web, "Order A", "P3"),
    item(web, "Order B", "P3"),
    item(web, "Order C", "P3"),
    item(api, "Body gets edited", "P1"),
    item(api, "Archive then undo", "P1"),
    item(api, "Two tabs edit this", "P1"),
    item(web, "Jump here by number", "P3", "doing"),
    item(api, "Ranking tweak one", "P2", "todo", { group: "Search quality" }),
    item(api, "Ranking tweak two", "P2", "todo", { group: "Search quality" }),
    item(web, "Press one on me", "P3"),
    item(web, "Synced with the CLI", "P2", "todo", { group: "Onboarding" }),
    item(api, "Write the **rollback** plan", "P1", "done", { group: "Release prep" }),
  ],
}
