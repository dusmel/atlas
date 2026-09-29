import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { createToken, listTokens } from "@/server/auth"
import { apiError } from "@/server/http"

export const Route = createFileRoute("/api/tokens")({
  server: {
    handlers: {
      GET: ({ context }) => {
        if (context?.auth.kind !== "session") return apiError(403, "session_only", "Tokens are managed from the browser")
        return Response.json(listTokens(getDb()))
      },
      POST: async ({ request, context }) => {
        if (context?.auth.kind !== "session") return apiError(403, "session_only", "Tokens are managed from the browser")
        const body = (await request.json().catch(() => null)) as { name?: unknown } | null
        const name = typeof body?.name === "string" ? body.name.trim() : ""
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
          return apiError(400, "bad_name", "Name must be 1 to 64 letters, digits, dots, dashes or underscores")
        }
        const db = getDb()
        if (db.query("SELECT 1 FROM api_tokens WHERE name = ?").get(name)) {
          return apiError(409, "name_taken", `A token named ${name} already exists`)
        }
        return Response.json({ name, ...createToken(db, name) }, { status: 201 })
      },
    },
  },
})
