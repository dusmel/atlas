import { generateKeyBetween } from "fractional-indexing"

// Rank keys order items within a column. A move writes one row: the new key sorts between its neighbours.
export function rankBetween(before: string | null, after: string | null): string {
  // fractional-indexing 4 no longer rejects swapped neighbours, and they come from the browser.
  if (before !== null && after !== null && before >= after) {
    throw new Error(`rank ${before} must sort before ${after}`)
  }
  return generateKeyBetween(before, after)
}
