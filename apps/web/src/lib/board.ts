import { byRank, ROWS, rowKey, type Item, type Row, type Status } from "./todos"

/** Cards a cell shows before "Show N more". */
export const CELL_LIMIT = 6

export type Cell = { status: Status; all: Item[]; shown: Item[] }
export type BoardRow = { row: Row; key: string; collapsed: boolean; cells: Cell[] }

export const cellKey = (row: Row, status: Status) => `${rowKey(row)}:${status}`

/** The board as drawn: rows, their lanes, and which cards each cell shows. Keyboard moves walk the same structure. */
export function layout(items: Item[], statuses: Status[], collapsed: Set<string>, expanded: Set<string>): BoardRow[] {
  return ROWS.map((row) => {
    const key = rowKey(row)
    const inRow = items.filter((i) => i.priority === row)
    const cells = statuses.map((status) => {
      const all = inRow.filter((i) => i.status === status).sort(byRank)
      const shown = collapsed.has(key) ? [] : expanded.has(cellKey(row, status)) ? all : all.slice(0, CELL_LIMIT)
      return { status, all, shown }
    })
    return { row, key, collapsed: collapsed.has(key), cells }
  })
}

type Where = { r: number; c: number; i: number }

function find(rows: BoardRow[], id: number): Where | null {
  for (const [r, row] of rows.entries())
    for (const [c, cell] of row.cells.entries()) {
      const i = cell.shown.findIndex((x) => x.id === id)
      if (i >= 0) return { r, c, i }
    }
  return null
}

export const firstShown = (rows: BoardRow[]) => rows.flatMap((r) => r.cells.flatMap((c) => c.shown))[0]?.id ?? null

/** The card a keyboard move lands on: down and up follow a lane through the rows, left and right stay in the row. */
export function step(rows: BoardRow[], id: number | null, dir: "up" | "down" | "left" | "right"): number | null {
  const at = id === null ? null : find(rows, id)
  if (!at) return firstShown(rows)
  const cell = rows[at.r]!.cells[at.c]!
  if (dir === "down" || dir === "up") {
    const next = cell.shown[at.i + (dir === "down" ? 1 : -1)]
    if (next) return next.id
    const order = dir === "down" ? rows.slice(at.r + 1) : rows.slice(0, at.r).reverse()
    for (const row of order) {
      const shown = row.cells[at.c]!.shown
      if (shown.length) return (dir === "down" ? shown[0] : shown.at(-1))!.id
    }
    return id
  }
  const cells = rows[at.r]!.cells
  const order = dir === "right" ? cells.slice(at.c + 1) : cells.slice(0, at.c).reverse()
  for (const c of order) if (c.shown.length) return c.shown[Math.min(at.i, c.shown.length - 1)]!.id
  return id
}
