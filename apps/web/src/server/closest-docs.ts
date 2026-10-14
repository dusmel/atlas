import type { DocMeta } from "@atlas/indexer"

const stem = (path: string) => path.replace(/\.(md|html)$/, "")

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = row
  }
  return prev[b.length]!
}

/** The docs whose paths are fewest edits from a missing one, its own repo first on a tie. Twins count once, as the html. */
export function closestDocs(files: DocMeta[], repo: string, path: string, n = 3): { repo: string; path: string; title: string }[] {
  const docs = new Map<string, DocMeta>()
  for (const f of files) {
    const key = `${f.repo}/${stem(f.path)}`
    if (!docs.has(key) || f.kind === "html") docs.set(key, f)
  }
  const want = stem(path).toLowerCase()
  return [...docs.values()]
    .map((f) => ({ f, d: distance(want, stem(f.path).toLowerCase()) + (f.repo === repo ? 0 : 0.5) }))
    .sort((a, b) => a.d - b.d || a.f.path.localeCompare(b.f.path))
    .slice(0, n)
    .map(({ f }) => ({ repo: f.repo, path: f.path, title: f.title }))
}
