// The app's 404: a chain link drawn in grey dots, broken in the middle, with terracotta sparks at the break.
import { cn } from "cn"

const focus = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Seeded, so the server and the browser draw the same dots. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function NotFound() {
  return (
    <main className="relative flex min-h-svh flex-col bg-background">
      <BrokenLink />
    </main>
  )
}

/** Points scattered across a band around a stadium shape (a rectangle with round ends). */
function stadium(rand: () => number, n: number, o: { cx: number; cy: number; w: number; h: number; band: number; tilt: number; squash: number; skip?: (x: number) => boolean }) {
  const r = o.h / 2
  const straight = o.w - o.h
  const per = 2 * straight + 2 * Math.PI * r
  const out: { x: number; y: number; s: number; a: number }[] = []
  for (let i = 0; i < n; i++) {
    let d = rand() * per
    let x: number, y: number, nx: number, ny: number
    if (d < straight) [x, y, nx, ny] = [-straight / 2 + d, -r, 0, -1]
    else if ((d -= straight) < Math.PI * r) {
      const a = -Math.PI / 2 + d / r
      ;[x, y, nx, ny] = [straight / 2 + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]
    } else if ((d -= Math.PI * r) < straight) [x, y, nx, ny] = [straight / 2 - d, r, 0, 1]
    else {
      const a = Math.PI / 2 + (d - straight) / r
      ;[x, y, nx, ny] = [-straight / 2 + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]
    }
    const off = (rand() - 0.5) * o.band
    x += nx * off
    y = (y + ny * off) * o.squash
    if (o.skip?.(x)) continue
    const cos = Math.cos(o.tilt)
    const sin = Math.sin(o.tilt)
    out.push({ x: o.cx + x * cos - y * sin, y: o.cy + x * sin + y * cos, s: 0.5 + rand() * 1.1, a: 0.35 + rand() * 0.65 })
  }
  return out
}

function BrokenLink() {
  const rand = random(404)
  const left = stadium(rand, 1700, { cx: 108, cy: 72, w: 150, h: 92, band: 18, tilt: 0.04, squash: 1, skip: (x) => x > 62 && rand() > 0.35 })
  const right = stadium(rand, 1500, { cx: 268, cy: 66, w: 190, h: 70, band: 16, tilt: -0.03, squash: 0.62, skip: (x) => x < -80 && rand() > 0.3 })
  const sparks = Array.from({ length: 220 }, () => {
    const a = rand() * Math.PI * 2
    const d = Math.pow(rand(), 1.6) * 44
    return { x: 172 + Math.cos(a) * d * 1.2, y: 70 + Math.sin(a) * d, s: 0.5 + rand() * 1.2, a: 0.4 + rand() * 0.6 }
  })
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-24 text-center">
      <svg aria-hidden viewBox="0 0 380 150" className="w-full max-w-[34rem] text-foreground/80">
        {[...left, ...right].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.s} fill="currentColor" opacity={p.a} />
        ))}
        <g className="motion-safe:animate-[spark_2.4s_ease-in-out_infinite]">
          {sparks.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.s} fill="var(--brand)" opacity={p.a} />
          ))}
        </g>
      </svg>
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">404</p>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Nothing here.</h1>
        <p className="text-muted-foreground">The link is broken, or the page has moved.</p>
        <a href="/" className={cn("mt-3 rounded border-b border-foreground/30 pb-0.5 text-sm hover:border-foreground", focus)}>
          Back home
        </a>
      </div>
    </section>
  )
}
