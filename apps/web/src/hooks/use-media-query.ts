import { useSyncExternalStore } from "react"

// The server has no screen, so it renders the desktop layout; the client corrects it after hydration.
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

export const useIsDesktop = () => useMediaQuery("(min-width: 768px)")
