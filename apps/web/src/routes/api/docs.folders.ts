import { createFileRoute } from "@tanstack/react-router"
import { docsFolder, filterInput } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/folders")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => docsFolder(url.searchParams.get("path") ?? "", filterInput(url)))
      },
    },
  },
})
