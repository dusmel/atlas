import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle, readJson } from "@/server/http"
import { applyImport } from "@/server/todos"

export const Route = createFileRoute("/api/imports")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const dryRun = new URL(request.url).searchParams.get("dry_run") === "1"
        return handle(async () => applyImport(getDb(), await readJson(request), dryRun), dryRun ? 200 : 201)
      },
    },
  },
})
