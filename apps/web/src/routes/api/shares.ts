import { createFileRoute } from "@tanstack/react-router"
import { shareDoc, sharesWithTitles } from "@/server/docs"
import { handle, HttpError, readJson } from "@/server/http"

export const Route = createFileRoute("/api/shares")({
  server: {
    handlers: {
      GET: () => handle(sharesWithTitles),
      POST: ({ request }) =>
        handle(async () => {
          const { repo, path } = await readJson(request)
          if (typeof repo !== "string" || typeof path !== "string") throw new HttpError(400, "bad_field", "Send repo and path, as in /r/<repo>/<path>")
          return shareDoc(repo, path)
        }, 201),
    },
  },
})
