// The app's 404: the fogged map clearing itself, the broken chain, then the words. The share 404 draws the same.
import { cn } from "cn"
import { LOST_CHAIN_CSS, LOST_CHAIN_SVG, LOST_FOG_CSS, LOST_FOG_HTML, LOST_MAP_CSS, LOST_MAP_SVG } from "@/lib/lost-map"

const focus = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

export function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12 text-center [--lost-dot:color-mix(in_oklab,var(--link)_38%,transparent)] [--lost-fg:var(--foreground)] [--lost-fog:var(--background)] [--lost-ink:var(--link)] [--lost-sea:color-mix(in_oklab,var(--link)_10%,var(--background))]">
      <style>{LOST_MAP_CSS + LOST_FOG_CSS + LOST_CHAIN_CSS}</style>
      <div aria-hidden className="lost-sea lost-auto aspect-[2/1] w-full max-w-xl rounded-2xl border" dangerouslySetInnerHTML={{ __html: LOST_MAP_SVG + LOST_FOG_HTML }} />
      <div aria-hidden className="w-full max-w-xs" dangerouslySetInnerHTML={{ __html: LOST_CHAIN_SVG }} />
      <div className="flex flex-col items-center gap-2">
        <p className="text-8xl font-semibold tracking-tighter tabular-nums sm:text-9xl">404</p>
        <h1 className="text-3xl font-semibold tracking-tight">Nothing here.</h1>
        <p className="text-muted-foreground">The link is broken, or the page has moved.</p>
        <a href="/" className={cn("mt-3 rounded border-b border-foreground/30 pb-0.5 text-sm hover:border-foreground", focus)}>
          Back home
        </a>
      </div>
    </main>
  )
}
