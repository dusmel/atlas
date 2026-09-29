import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true, version: __ATLAS_VERSION__ }),
    },
  },
})
