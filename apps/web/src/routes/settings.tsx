import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/settings")({ component: Settings })

type Token = { id: number; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

// Cookie-authenticated changes must carry X-Atlas (spec section 8).
const api = (path: string, init: RequestInit = {}) =>
  fetch(path, { ...init, headers: { "content-type": "application/json", "x-atlas": "1", ...init.headers } })

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "never")

function Settings() {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const res = await api("/api/tokens")
    if (res.ok) setTokens(await res.json())
    else setError("Could not load tokens.")
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const res = await api("/api/tokens", { method: "POST", body: JSON.stringify({ name }) })
    const body = await res.json()
    if (!res.ok) return setError(body.error?.message ?? "Could not create the token.")
    setCreated({ name: body.name, token: body.token })
    setName("")
    await load()
  }

  const revoke = async (t: Token) => {
    if (!confirm(`Revoke ${t.name}? Anything using it stops working.`)) return
    const res = await api(`/api/tokens/${t.id}`, { method: "DELETE" })
    if (!res.ok) setError("Could not revoke the token.")
    await load()
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-medium">Settings</h1>
        <Link to="/" className="text-sm underline underline-offset-4">
          Home
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>One per device or agent. The CLI sends it as a bearer token. A token is shown once.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="token-name">Name</Label>
              <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="irembo-mac" required />
            </div>
            <Button type="submit">Create token</Button>
          </form>

          {created ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p>
                Token <strong>{created.name}</strong>. Copy it into 1Password now; it will not be shown again.
              </p>
              <code className="break-all rounded bg-muted p-2 font-mono text-xs">{created.token}</code>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(created.token)}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {tokens === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-muted-foreground">
                      created {day(t.created_at)}, last used {day(t.last_used_at)}
                      {t.revoked_at ? `, revoked ${day(t.revoked_at)}` : ""}
                    </p>
                  </div>
                  {t.revoked_at ? null : (
                    <Button size="sm" variant="destructive" onClick={() => void revoke(t)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
