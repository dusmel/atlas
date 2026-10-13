import { createRouter as createTanStackRouter, ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

// After a rebuild or a deploy, an open tab asks for code files the new build no longer has. Load the page fresh,
// at most once in 10 s so a real outage can't loop.
function RouteError(props: ErrorComponentProps) {
  const stale = /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(props.error))
  if (stale && typeof window !== "undefined" && Date.now() - Number(sessionStorage.getItem("atlas-reloaded") ?? 0) > 10_000) {
    sessionStorage.setItem("atlas-reloaded", String(Date.now()))
    window.location.reload()
    return null
  }
  return <ErrorComponent {...props} />
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouteError,
    // Plain query strings. The default JSON encoding quotes numeric strings: ?group=%221%22.
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: (search) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(search)) if (v !== undefined && v !== null) params.set(k, String(v))
      const s = params.toString().replace(/%2C/g, ",")
      return s ? `?${s}` : ""
    },
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
