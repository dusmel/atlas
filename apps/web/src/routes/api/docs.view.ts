import { createFileRoute } from "@tanstack/react-router"
import { viewDoc } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/view")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => viewDoc(url.searchParams.get("repo") ?? "", url.searchParams.get("path") ?? ""))
      },
    },
  },
})
