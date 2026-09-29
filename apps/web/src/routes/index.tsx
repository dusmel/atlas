import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <main className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Atlas</h1>
          <p>Todos and docs across every repo. Nothing here yet.</p>
          <div className="mt-2 flex gap-2">
            <Button asChild>
              <Link to="/settings">Settings</Link>
            </Button>
            <form method="post" action="/logout">
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
