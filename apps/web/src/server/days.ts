import { HttpError } from "./http"

/** The year grids show 53 weeks; a few spare days cover the first week's start. */
export const yearAgo = (now = Date.now()) => new Date(now - 372 * 864e5).toISOString()

/** SQLite's `date()` modifier for the viewer's offset from UTC in minutes, as `-getTimezoneOffset()` gives it. */
export function tzModifier(tz: string | null | undefined): string {
  const n = Number(tz ?? 0)
  if (!Number.isInteger(n) || Math.abs(n) > 840) throw new HttpError(400, "bad_tz", "tz must be whole minutes from UTC, -840 to 840")
  return `${n < 0 ? "" : "+"}${n} minutes`
}
