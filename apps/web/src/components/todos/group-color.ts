// A stable hue per group name, so a group keeps its colour across repos and reloads.
export function groupHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

export const groupColor = (name: string | null) => (name ? `oklch(var(--group-l) var(--group-c) ${groupHue(name)})` : "transparent")
