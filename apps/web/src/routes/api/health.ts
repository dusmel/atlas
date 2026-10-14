import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { getIndex } from "@/server/docs"
import { readMega, readSource } from "@/server/docs-source"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          getDb().query("SELECT 1").get()
          const docs = { source: readSource().source, last_pull: readMega().last_pull, count: getIndex().counts().docs }
          return Response.json({ ok: true, version: __ATLAS_VERSION__, db: "ok", docs })
        } catch (err) {
          console.error("atlas: health check failed", err)
          return Response.json({ ok: false, version: __ATLAS_VERSION__, db: "error" }, { status: 503 })
        }
      },
    },
  },
})
