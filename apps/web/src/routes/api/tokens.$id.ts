import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { revokeToken } from "@/server/auth"
import { apiError } from "@/server/http"

export const Route = createFileRoute("/api/tokens/$id")({
  server: {
    handlers: {
      DELETE: ({ params, context }) => {
        if (context?.auth.kind !== "session") return apiError(403, "session_only", "Tokens are managed from the browser")
        if (!revokeToken(getDb(), Number(params.id))) return apiError(404, "not_found", `No active token ${params.id}`)
        return new Response(null, { status: 204 })
      },
    },
  },
})
