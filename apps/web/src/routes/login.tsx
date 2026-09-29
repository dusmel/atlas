import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getDb } from "@/server/app-db"
import { checkPassword, clientIp, createSession, loginThrottle, sessionCookie } from "@/server/auth"

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { error?: 1 } => (search.error ? { error: 1 } : {}),
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request)
        if (!loginThrottle.attempt(ip)) {
          return new Response("Too many attempts. Try again in 10 minutes.", { status: 429 })
        }
        const form = await request.formData().catch(() => null)
        const password = form?.get("password")
        if (typeof password !== "string" || !(await checkPassword(password))) {
          return new Response(null, { status: 303, headers: { location: "/login?error=1" } })
        }
        loginThrottle.clear(ip)
        const id = createSession(getDb())
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": sessionCookie(id) } })
      },
    },
  },
  component: Login,
})

function Login() {
  const { error } = Route.useSearch()
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Atlas</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" action="/login" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
            </div>
            {error ? <p className="text-sm text-destructive">Wrong password.</p> : null}
            <Button type="submit">Log in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
