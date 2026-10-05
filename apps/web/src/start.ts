import { createMiddleware, createStart } from "@tanstack/react-start"
import { getDb } from "./server/app-db"
import { authenticate } from "./server/auth"
import { apiError } from "./server/http"

const PUBLIC = new Set(["/login", "/api/health"])

// One gate for pages, API routes and server functions (spec section 8).
const gate = createMiddleware().server(async ({ request, pathname, next }) => {
  if (PUBLIC.has(pathname)) return next()
  const api = pathname.startsWith("/api/")
  let auth: ReturnType<typeof authenticate>
  try {
    auth = authenticate(getDb(), request)
  } catch (err) {
    console.error("auth gate: database unavailable", err)
    return api ? apiError(500, "db_unavailable", "The database could not be opened") : new Response("The database could not be opened", { status: 500 })
  }
  if (!auth) {
    return api ? apiError(401, "unauthorized", "Log in or send a bearer token") : new Response(null, { status: 302, headers: { location: "/login" } })
  }
  const mutation = request.method !== "GET" && request.method !== "HEAD"
  if (api && mutation && auth.kind === "session" && request.headers.get("x-atlas") !== "1") {
    return apiError(403, "missing_header", "Cookie-authenticated changes need the X-Atlas: 1 header")
  }
  return next({ context: { auth } })
})

export const startInstance = createStart(() => ({ requestMiddleware: [gate] }))
