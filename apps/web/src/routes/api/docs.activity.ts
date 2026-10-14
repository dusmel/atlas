import { createFileRoute } from "@tanstack/react-router"
import { docsActivity } from "@/server/docs"
import { handle } from "@/server/http"

const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

export const Route = createFileRoute("/api/docs/activity")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => docsActivity({ repo: many(url, "repo"), folder: many(url, "folder"), since: url.searchParams.get("since") ?? undefined }))
      },
    },
  },
})
