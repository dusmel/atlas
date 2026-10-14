import { createFileRoute } from "@tanstack/react-router"
import { searchDocs } from "@/server/docs"
import { handle } from "@/server/http"

const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() =>
          searchDocs({ q: url.searchParams.get("q") ?? "", repo: many(url, "repo"), folder: many(url, "folder"), since: url.searchParams.get("since") ?? undefined, limit: url.searchParams.get("limit") ?? undefined }),
        )
      },
    },
  },
})
