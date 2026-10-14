// The 404 map, as a string, so the app's 404 and the share 404 (plain html, no scripts) draw the same one.
// It inks itself in currentColor. The page drifts in once, in 0.8 s, and stays still under reduced motion.
export const LOST_MAP_CSS = `
.lost-map { display: block; width: 100%; height: auto; }
.lost-map .drift { animation: lost-drift 0.8s cubic-bezier(.2,.7,.3,1) both; transform-box: fill-box; }
@keyframes lost-drift { from { transform: translate(-150px, 36px) rotate(-14deg); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .lost-map .drift { animation: none; } }
`

export const LOST_MAP_SVG = `<svg class="lost-map" viewBox="0 0 720 360" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<g stroke-opacity=".1">${[60, 120, 180, 240, 300].map((y) => `<path d="M0 ${y}H720"/>`).join("")}${[90, 180, 270, 360, 450, 540, 630].map((x) => `<path d="M${x} 0V360"/>`).join("")}</g>
<g stroke-opacity=".45" stroke-width="1.5" fill="currentColor" fill-opacity=".06">
<path d="M96 120c18-34 70-44 104-26 30 16 58 6 74 30 18 28-6 64-44 70-30 5-46 26-82 18-40-9-70-58-52-92z"/>
<path d="M330 228c10-28 50-36 78-24 22 9 46 2 58 22 14 24-8 52-40 56-26 3-40 20-66 12-30-9-40-40-30-66z"/>
<path d="M420 70c16-20 52-22 70-6 14 12 34 10 40 28 7 20-14 36-38 34-20-2-34 10-52 0-22-12-34-38-20-56z"/>
</g>
<path class="route" d="M170 150C250 190 300 140 360 190S420 250 470 110" stroke-opacity=".5" stroke-width="2" stroke-dasharray="2 9"/>
<path class="x" d="M462 102l16 16M478 102l-16 16" stroke-width="3" stroke-opacity=".7"/>
<g transform="translate(64 266)" stroke-opacity=".5"><circle r="24"/><path d="M0-34V34M-34 0H34" stroke-opacity=".3"/><path class="needle" d="M0-22L6 0 0 22-6 0Z" fill="currentColor" fill-opacity=".5"/></g>
<g transform="translate(640 196) rotate(12)"><g class="drift">
<path d="M0 0h44l16 16v62H0Z" fill="currentColor" fill-opacity=".08" stroke-width="2"/><path d="M44 0v16h16" stroke-width="2"/>
<path d="M10 32h38M10 44h38M10 56h26" stroke-opacity=".5" stroke-width="2"/>
</g></g>
<path d="M600 250c18 6 30 6 44 0s28-6 44 0M612 270c14 5 26 5 38 0" stroke-opacity=".35" stroke-width="1.5"/>
</svg>`

// The fogged map: the map above under a fog of dots, then a "404" stamp on the X once it's found. CSS only, so the
// share 404 can use it. The host sizes `.lost-sea` and sets --lost-fg, --lost-sea, --lost-fog, --lost-dot and --lost-ink.
// Plain, the mouse wipes the fog. With `.lost-auto` it clears itself from left to right, and the mouse does nothing.
const FOG_COLS = 24
const FOG_ROWS = 12
// The cursor wipes its cell and the four around it: the cells beside it, and the ones a row (FOG_COLS cells) above and below.
const FOG_BRUSH = [".fog i:hover + i", ".fog i:has(+ i:hover)", `.fog i:hover${" + i".repeat(FOG_COLS)}`, `.fog i:has(${"+ i ".repeat(FOG_COLS - 1)}+ i:hover)`].join(", ")

export const LOST_FOG_CSS = `
.lost-sea { position: relative; overflow: hidden; background: var(--lost-sea); color: var(--lost-fg); }
.lost-sea > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.lost-map .route, .lost-map .x { stroke: var(--lost-ink); stroke-opacity: 1; }
.lost-map .needle { transform-box: fill-box; transform-origin: center; animation: lost-search 7s ease-in-out infinite; }
.lost-map .drift { animation: lost-drift 0.8s cubic-bezier(.2,.7,.3,1) both, lost-bob 3.2s ease-in-out 0.8s infinite alternate; }
@keyframes lost-search { 0%, 100% { rotate: 0deg; } 20% { rotate: 130deg; } 32% { rotate: 95deg; } 55% { rotate: -150deg; } 70% { rotate: -110deg; } 85% { rotate: 40deg; } }
@keyframes lost-bob { to { transform: translateY(-5px) rotate(3deg); } }
.fog { position: absolute; inset: 0; display: grid; grid-template: repeat(${FOG_ROWS}, 1fr) / repeat(${FOG_COLS}, 1fr); }
.fog i { opacity: var(--a); background: radial-gradient(circle, var(--lost-dot) 0 2px, transparent 2.5px) var(--lost-fog); box-shadow: 0 0 0 0.5px var(--lost-fog); animation: lost-wipe 0.15s ease-out forwards paused; }
@keyframes lost-wipe { to { opacity: 0; } }
/* A paused animation keeps its progress when hover ends, so wiped fog stays wiped and a found X stays found. */
.fog i:hover, ${FOG_BRUSH} { animation-play-state: running; }
.lost-stamp { pointer-events: none; opacity: 0; animation: lost-show 1ms forwards paused; }
.lost-sea:has(.dig:hover) .lost-stamp { animation-play-state: running; }
@keyframes lost-show { to { opacity: 1; } }
/* Fingers can't hover, so the fog burns off by itself, outward from the X. */
@media (hover: none) {
  .fog i { animation-duration: 0.6s; animation-delay: calc(0.5s + var(--d) * 60ms); animation-play-state: running; }
  .lost-stamp { animation-delay: 1.2s; animation-play-state: running; }
}
.lost-auto .fog i { animation-duration: 1.4s; animation-timing-function: ease-in-out; animation-delay: calc(0.5s + var(--s) * 220ms); animation-play-state: running; }
/* The X's cells (--s 15 to 17.5) are clear by about 5.8 s. */
.lost-auto .lost-stamp { animation-delay: 5.9s; animation-play-state: running; }
@media (prefers-reduced-motion: reduce) {
  .lost-map .drift, .lost-map .needle { animation: none; }
  .fog i, .lost-auto .fog i { animation-delay: 0s; animation-duration: 0.01s; }
  .lost-stamp, .lost-auto .lost-stamp { animation-delay: 0s; }
}
`

/** One fog cell per 30 by 30 square of the map's 720 by 360 box. Seeded, so the fog is the same on every visit. */
const FOG = (() => {
  let seed = 404
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let out = ""
  for (let row = 0; row < FOG_ROWS; row++)
    for (let col = 0; col < FOG_COLS; col++) {
      // The X sits at (470, 110): column 15, row 3. Its fog stays thick, and the drifting page at the right edge peeks through.
      const dig = Math.abs(col - 15) <= 1 && Math.abs(row - 3) <= 1
      const peek = !dig && ((col >= 20 && row >= 5 && row <= 9 && rand() < 0.5) || rand() < 0.06)
      const a = dig ? 1 : peek ? 0.3 + rand() * 0.25 : 0.94 + rand() * 0.06
      // --d: rings out from the X, for touch. --s: a ragged left-to-right sweep, for `.lost-auto`.
      const d = Math.round(Math.hypot(col - 15, row - 3))
      const s = (col + rand() * 2.5).toFixed(1)
      out += `<i${dig ? ' class="dig"' : ""} style="--a:${a.toFixed(2)};--d:${d};--s:${s}"></i>`
    }
  return out
})()

export const LOST_FOG_HTML = `<div class="fog" aria-hidden="true">${FOG}</div>
<svg class="lost-stamp" viewBox="0 0 720 360" aria-hidden="true"><g transform="translate(470 110) rotate(-12)" fill="none" stroke="var(--lost-ink)">
<circle r="50" stroke-width="3" fill="var(--lost-sea)"/><circle r="42" stroke-width="1.5" stroke-dasharray="3 5"/>
<text y="9" text-anchor="middle" fill="var(--lost-ink)" stroke="none" font-size="28" font-weight="700">404</text>
<text y="26" text-anchor="middle" fill="var(--lost-ink)" stroke="none" font-size="9" letter-spacing="1">not here</text>
</g></svg>`

// The broken chain under the map: two links in grey dots, apart, with terracotta sparks at the break.
/** Seeded, so every page draws the same dots. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

const dots = (ps: { x: number; y: number; s: number; a: number }[]) => ps.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.s.toFixed(2)}" opacity="${p.a.toFixed(2)}"/>`).join("")

export const LOST_CHAIN_SVG = (() => {
  const rand = random(404)
  const left = stadium(rand, 1700, { cx: 108, cy: 72, w: 150, h: 92, band: 18, tilt: 0.04, squash: 1, skip: (x) => x > 62 && rand() > 0.35 })
  const right = stadium(rand, 1500, { cx: 268, cy: 66, w: 190, h: 70, band: 16, tilt: -0.03, squash: 0.62, skip: (x) => x < -80 && rand() > 0.3 })
  const sparks = Array.from({ length: 220 }, () => {
    const a = rand() * Math.PI * 2
    const d = Math.pow(rand(), 1.6) * 44
    return { x: 172 + Math.cos(a) * d * 1.2, y: 70 + Math.sin(a) * d, s: 0.5 + rand() * 1.2, a: 0.4 + rand() * 0.6 }
  })
  return `<svg class="lost-chain" viewBox="0 0 380 150" aria-hidden="true"><g fill="currentColor">${dots([...left, ...right])}</g><g class="sparks" fill="var(--lost-ink)">${dots(sparks)}</g></svg>`
})()

export const LOST_CHAIN_CSS = `
.lost-chain { display: block; width: 100%; height: auto; color: var(--lost-fg); opacity: 0.8; }
.lost-chain .sparks { animation: lost-spark 2.4s ease-in-out infinite; }
@keyframes lost-spark { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .lost-chain .sparks { animation: none; } }
`
