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
<path d="M170 150C250 190 300 140 360 190S420 250 470 110" stroke-opacity=".5" stroke-width="2" stroke-dasharray="2 9"/>
<path d="M462 102l16 16M478 102l-16 16" stroke-width="3" stroke-opacity=".7"/>
<g transform="translate(64 266)" stroke-opacity=".5"><circle r="24"/><path d="M0-34V34M-34 0H34" stroke-opacity=".3"/><path d="M0-22L6 0 0 22-6 0Z" fill="currentColor" fill-opacity=".5"/></g>
<g transform="translate(640 196) rotate(12)"><g class="drift">
<path d="M0 0h44l16 16v62H0Z" fill="currentColor" fill-opacity=".08" stroke-width="2"/><path d="M44 0v16h16" stroke-width="2"/>
<path d="M10 32h38M10 44h38M10 56h26" stroke-opacity=".5" stroke-width="2"/>
</g></g>
<path d="M600 250c18 6 30 6 44 0s28-6 44 0M612 270c14 5 26 5 38 0" stroke-opacity=".35" stroke-width="1.5"/>
</svg>`
