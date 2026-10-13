// Three 404 designs for the owner to compare at ?design=a|b|c. The ones not picked get deleted.
import { useLocation } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { cn } from "cn"

const focus = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
const DESIGNS = [
  { id: "a", label: "A · Broken link" },
  { id: "b", label: "B · Dots" },
  { id: "c", label: "C · Screen" },
] as const
type Design = (typeof DESIGNS)[number]["id"]

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
  const raw = useLocation({ select: (l) => (l.search as { design?: string }).design })
  const design: Design = raw === "b" || raw === "c" ? raw : "a"
  return (
    <main className="relative flex min-h-svh flex-col bg-background">
      <nav aria-label="404 design" className="absolute top-4 right-4 z-10 flex flex-wrap justify-end gap-1 text-xs">
        {DESIGNS.map((d) => (
          <a
            key={d.id}
            href={`?design=${d.id}`}
            aria-current={design === d.id ? "page" : undefined}
            className={cn("rounded-full border bg-background/70 px-2.5 py-1 text-muted-foreground backdrop-blur hover:bg-muted aria-[current=page]:border-transparent aria-[current=page]:bg-foreground aria-[current=page]:text-background", focus)}
          >
            {d.label}
          </a>
        ))}
      </nav>
      {design === "a" ? <BrokenLink /> : design === "b" ? <DotsNumber /> : <Screen />}
    </main>
  )
}

// ---------- A: a chain link drawn in grey dots, broken in the middle, with terracotta sparks at the break.

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

// ---------- B: a big "404" made of terracotta dots that gather once on load, with the words at the bottom left.

/** Dots along the strokes of a slanted, brush-like 404, in a 900 by 420 box. */
function digitDots(): { x: number; y: number; s: number; a: number }[] {
  const rand = random(7)
  const out: { x: number; y: number; s: number; a: number }[] = []
  const brush = (x1: number, y1: number, x2: number, y2: number, w: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = rand()
      const off = (rand() - 0.5) * w * (0.6 + 0.4 * Math.sin(t * Math.PI))
      const len = Math.hypot(x2 - x1, y2 - y1)
      out.push({ x: x1 + (x2 - x1) * t - ((y2 - y1) / len) * off, y: y1 + (y2 - y1) * t + ((x2 - x1) / len) * off, s: 0.6 + rand() * 1.3, a: 0.25 + rand() * 0.75 })
    }
  }
  const ring = (cx: number, cy: number, rx: number, ry: number, w: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const off = (rand() - 0.5) * w * (0.75 + 0.25 * Math.cos(a * 2))
      out.push({ x: cx + Math.cos(a) * (rx + off), y: cy + Math.sin(a) * (ry + off), s: 0.6 + rand() * 1.3, a: 0.25 + rand() * 0.75 })
    }
  }
  const four = (dx: number, dy: number) => {
    brush(dx + 170, dy + 10, dx + 40, dy + 230, 70, 1500)
    brush(dx + 30, dy + 235, dx + 250, dy + 205, 64, 1200)
    brush(dx + 165, dy + 60, dx + 175, dy + 330, 66, 1300)
  }
  four(40, 30)
  ring(455, 210, 95, 150, 70, 2600)
  four(600, 70)
  return out
}

function DotsNumber() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const dots = digitDots()
    const rand = random(11)
    const from = dots.map(() => ({ x: rand() * 900, y: rand() * 420 }))
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const color = getComputedStyle(el).getPropertyValue("--brand").trim() || "#b4532f"
    let frame = 0
    const start = performance.now()
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = el.getBoundingClientRect()
      el.width = width * dpr
      el.height = height * dpr
      const scale = Math.min(width / 900, height / 420)
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (dpr * (width - 900 * scale)) / 2, (dpr * (height - 420 * scale)) / 2)
      ctx.fillStyle = color
      const k = still ? 1 : Math.min(1, (now - start) / 1400)
      const ease = 1 - Math.pow(1 - k, 3)
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]!
        ctx.globalAlpha = d.a * (0.3 + 0.7 * ease)
        ctx.beginPath()
        ctx.arc(from[i]!.x + (d.x - from[i]!.x) * ease, from[i]!.y + (d.y - from[i]!.y) * ease, d.s, 0, Math.PI * 2)
        ctx.fill()
      }
      if (k < 1) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    const redraw = () => requestAnimationFrame(draw)
    window.addEventListener("resize", redraw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", redraw)
    }
  }, [])
  return (
    <section className="relative flex flex-1 flex-col justify-end overflow-hidden px-6 pt-20 pb-12 sm:px-14 sm:pb-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,color-mix(in_oklab,var(--brand)_12%,transparent),transparent)]" />
      <canvas ref={canvas} aria-hidden className="absolute inset-x-0 top-10 bottom-48 h-auto w-full sm:bottom-40" style={{ height: "calc(100% - 12rem)" }} />
      <div className="relative flex max-w-3xl flex-col gap-1">
        <h1 className="text-3xl tracking-tight text-brand sm:text-4xl dark:text-link">Page not found</h1>
        <p className="text-3xl tracking-tight sm:text-4xl">The page you were looking for does not exist or has moved.</p>
        <a href="/" className={cn("mt-5 self-start rounded-full bg-muted px-4 py-2 text-sm hover:bg-muted/70", focus)}>
          Back home
        </a>
      </div>
    </section>
  )
}

// ---------- C: a light card with a small retro screen showing colour bars and 404.

function Screen() {
  const bars = [1, 3, 5, 6, 0, 8, 2].map((i) => `var(--palette-${i})`)
  return (
    <section className="flex flex-1 items-center justify-center bg-muted/60 px-4 py-20">
      <div className="flex w-full max-w-4xl flex-col items-center gap-10 rounded-[32px] bg-card px-6 py-14 shadow-[0_1px_0_var(--border)] sm:flex-row sm:justify-center sm:gap-16 sm:px-12">
        <svg aria-hidden viewBox="0 0 300 250" className="w-full max-w-72 shrink-0">
          <ellipse cx="146" cy="226" rx="112" ry="12" fill="var(--foreground)" opacity="0.9" />
          <g transform="rotate(-9 150 130)" stroke="var(--foreground)" strokeWidth="3" strokeLinejoin="round">
            <rect x="60" y="46" width="200" height="150" rx="16" fill="var(--muted)" />
            <path d="M58 76 L44 86 M244 46 L230 58 M260 180 L244 196" strokeLinecap="round" />
            <rect x="42" y="60" width="200" height="150" rx="16" fill="var(--card)" />
            <circle cx="68" cy="96" r="10" fill="none" />
            <circle cx="68" cy="96" r="3" fill="var(--foreground)" />
            <path d="M58 136 h20 M58 146 h20 M58 156 h20 M58 166 h20" strokeLinecap="round" />
            <rect x="94" y="74" width="134" height="122" rx="12" fill="var(--foreground)" />
          </g>
          <g transform="rotate(-9 150 130)">
            <clipPath id="nf-screen">
              <rect x="102" y="82" width="118" height="106" rx="8" />
            </clipPath>
            <g clipPath="url(#nf-screen)">
              {bars.map((c, i) => (
                <rect key={i} x={102 + i * 16.86} y="82" width="17" height="106" fill={c} />
              ))}
              <rect x="102" y="123" width="118" height="26" fill="var(--foreground)" />
              <text x="161" y="142" textAnchor="middle" fill="var(--background)" fontFamily="var(--font-mono)" fontSize="17" fontWeight="700" letterSpacing="9">
                404
              </text>
            </g>
          </g>
        </svg>
        <div className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
          <h1 className="text-5xl font-semibold tracking-tight">No signal.</h1>
          <p className="max-w-60 text-lg leading-snug text-muted-foreground">We couldn't find the page you were looking for.</p>
          <a href="/" className={cn("mt-3 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/85", focus)}>
            <ArrowLeftIcon aria-hidden className="size-4" />
            Go home
          </a>
        </div>
      </div>
    </section>
  )
}
