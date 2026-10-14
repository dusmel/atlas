import { createFileRoute } from "@tanstack/react-router"
import { holdDocs } from "@/server/docs"
import { handle } from "@/server/http"

// `atlas push` holds before it sends, and `atlas push --resume-mega` lets go (spec section 7).
export const Route = createFileRoute("/api/docs/hold")({
  server: {
    handlers: {
      POST: () => handle(() => holdDocs("manual")),
      DELETE: () => handle(() => holdDocs("mega")),
    },
  },
})
