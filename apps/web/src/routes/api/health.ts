import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          getDb().query("SELECT 1").get()
          return Response.json({ ok: true, version: __ATLAS_VERSION__, db: "ok" })
        } catch (err) {
          console.error("atlas: health check failed", err)
          return Response.json({ ok: false, version: __ATLAS_VERSION__, db: "error" }, { status: 503 })
        }
      },
    },
  },
})
