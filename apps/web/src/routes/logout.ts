import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { clearedSessionCookie, deleteSession, readCookie, SESSION_COOKIE } from "@/server/auth"

export const Route = createFileRoute("/logout")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const id = readCookie(request, SESSION_COOKIE)
        if (id) deleteSession(getDb(), id)
        return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": clearedSessionCookie } })
      },
    },
  },
})
