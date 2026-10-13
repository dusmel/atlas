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
// Plain, the mouse wipes the fog. With `.lost-auto` it clears itself from left to right.
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
.lost-auto .fog i { animation-duration: 0.7s; animation-delay: calc(0.3s + var(--s) * 110ms); animation-play-state: running; }
.lost-auto .lost-stamp { animation-delay: 2.9s; animation-play-state: running; }
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
