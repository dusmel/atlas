export type DocFile = { repo: string; path: string; kind: "md" | "html" }

const IMPORTED_TODO = /^TODO\.imported-.*\.md$/

// Lists the docs under <root>/<repo>/. Dotfiles (.DS_Store) are skipped by the glob itself.
export async function scanDocs(root: string): Promise<DocFile[]> {
  const docs: DocFile[] = []
  for await (const rel of new Bun.Glob("*/**/*.{md,html}").scan({ cwd: root })) {
    const parts = rel.split("/")
    const repo = parts[0]!
    const name = parts.at(-1)!
    if (parts.includes("backups") || IMPORTED_TODO.test(name)) continue
    docs.push({ repo, path: parts.slice(1).join("/"), kind: name.endsWith(".md") ? "md" : "html" })
  }
  return docs.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path))
}
