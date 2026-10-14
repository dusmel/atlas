import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle } from "@/server/http"
import { revokeShare } from "@/server/shares"

export const Route = createFileRoute("/api/shares/$token")({
  server: {
    handlers: {
      DELETE: ({ params }) => handle(() => (revokeShare(getDb(), params.token), { revoked: params.token })),
    },
  },
})
