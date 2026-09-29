import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <main className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Atlas</h1>
          <p>Todos and docs across every repo. Nothing here yet.</p>
          <Button className="mt-2" asChild>
            <a href="/api/health">Health check</a>
          </Button>
        </div>
      </div>
    </main>
  )
}
