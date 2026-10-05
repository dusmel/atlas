// Production server: files from dist/client, everything else to the Start handler.
import { join } from "node:path"

const clientDir = join(import.meta.dir, "dist/client")
const serverEntry = join(import.meta.dir, "dist/server/server.js")
const app: { fetch(req: Request): Response | Promise<Response> } = (await import(serverEntry)).default

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const { pathname } = new URL(req.url)
    const path = join(clientDir, pathname)
    if (pathname !== "/" && path.startsWith(clientDir + "/")) {
      const file = Bun.file(path)
      if (await file.exists()) {
        const headers: Record<string, string> = pathname.startsWith("/assets/")
          ? { "cache-control": "public, max-age=31536000, immutable" }
          : {}
        return new Response(file, { headers })
      }
    }
    // Start hands back a plain error object when a handler throws. Bun would answer that with a 200 welcome page.
    const res = await app.fetch(req)
    return res instanceof Response ? res : Response.json({ error: { code: "internal", message: "Unexpected server error" } }, { status: 500 })
  },
})

console.log(`atlas web listening on ${server.url}`)
