import { DocIndex } from "@atlas/indexer"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { movedFrom, placeOf, recordDocIds } from "../src/server/doc-ids"
import { createShare } from "../src/server/shares"
import { createGroup, updateGroup } from "../src/server/todos"
import { freshDb, tempDir } from "./helpers"

const repo = { id: "github.com-demo-web", name: "demo-web" }
const folders = new Map([[repo.id, "web"]])

describe("doc ids", () => {
  let root: string
  let index: DocIndex
  const db = freshDb()
  const write = (path: string, text: string) => Bun.write(join(root, path), text)
  const groupDocIds = () => db.query<{ label: string; doc_id: string | null }, []>("SELECT label, doc_id FROM group_docs ORDER BY label").all()

  beforeEach(async () => {
    root = tempDir()
    index = new DocIndex(root)
    await write("web/notes/harbour.md", "---\natlas-id: d_harbour001\n---\n# Harbour")
    await write("web/plans/lamp.md", "# No id")
    // The server records after every sync that changed something.
    await index.sync()
    recordDocIds(db, index, folders)
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  test("a share and a group doc follow their doc after a rename, and the old path leads to the new one", async () => {
    const share = createShare(db, "web", "notes/harbour.md")
    const group = createGroup(db, { repo, name: "Tides", docs: [{ label: "overview", path: "./notes/harbour.md" }, { label: "plan", path: "plans/lamp.md" }] })
    expect(share.doc_id).toBeNull()

    // The rename is the first sync after the share and the group: the old path still knows the id.
    await rename(join(root, "web/notes/harbour.md"), join(root, "web/notes/harbour-notes.md"))
    await index.sync()
    recordDocIds(db, index, folders)

    const shared = db.query<{ doc_id: string }, [string]>("SELECT doc_id FROM shares WHERE token = ?").get(share.token)!
    expect(shared.doc_id).toBe("d_harbour001")
    expect(placeOf(index, shared.doc_id, { repo: "web", path: "notes/harbour.md" })).toEqual({ repo: "web", path: "notes/harbour-notes.md" })
    expect(groupDocIds()).toEqual([
      { label: "overview", doc_id: "d_harbour001" },
      { label: "plan", doc_id: null },
    ])
    expect(movedFrom(db, index, { repo: "web", path: "notes/harbour.md" })).toEqual({ repo: "web", path: "notes/harbour-notes.md" })
    expect(movedFrom(db, index, { repo: "web", path: "notes/harbour-notes.md" })).toBeNull()
    expect(movedFrom(db, index, { repo: "web", path: "plans/gone.md" })).toBeNull()

    // A doc without an id stays where it was stored.
    expect(placeOf(index, null, { repo: "web", path: "plans/lamp.md" })).toEqual({ repo: "web", path: "plans/lamp.md" })
    // Making the doc public again from its new path returns the same link.
    expect(createShare(db, "web", "notes/harbour-notes.md", "d_harbour001").token).toBe(share.token)

    // Editing the group keeps the id of a doc whose label and path stayed.
    updateGroup(db, group.id, { docs: [{ label: "overview", path: "./notes/harbour.md" }, { label: "design", path: "plans/lamp.md" }] })
    expect(groupDocIds()).toEqual([
      { label: "design", doc_id: null },
      { label: "overview", doc_id: "d_harbour001" },
    ])
  })

  test("an id two docs hold leads nowhere", async () => {
    await write("web/copy.md", "---\natlas-id: d_harbour001\n---\n# Copy")
    await rm(join(root, "web/notes/harbour.md"))
    await write("web/notes/elsewhere.md", "---\natlas-id: d_harbour001\n---\n# Harbour")
    await index.sync()
    expect(placeOf(index, "d_harbour001", { repo: "web", path: "notes/harbour.md" })).toEqual({ repo: "web", path: "notes/harbour.md" })
    expect(movedFrom(db, index, { repo: "web", path: "notes/harbour.md" })).toBeNull()
  })
})
