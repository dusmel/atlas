import { createFileRoute } from "@tanstack/react-router"
import { publishDoc } from "@/server/docs"
import { handle, readJson } from "@/server/http"

// `atlas doc publish` (spec section 9, fast publish).
export const Route = createFileRoute("/api/docs/publish")({
  server: {
    handlers: {
      POST: ({ request }) => handle(async () => publishDoc(await readJson(request)), 201),
    },
  },
})
