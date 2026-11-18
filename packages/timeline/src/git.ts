// Reads an effort's branches from a local checkout. Each branch's commits are the ones no earlier
// branch in the stack and not the base branch has, so a stacked branch shows only its own work.
// A branch merged with a merge commit has no such commits left, so it takes the ones its merge brought in.

export type Commit = { hash: string; short: string; at: string; day: string; subject: string }
export type BranchWork = { branch: string; commits: Commit[] }

async function git(cwd: string, args: string[]): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err.trim()}`)
  return out
}

/** origin's default branch, else main, else master. */
export async function baseBranch(cwd: string): Promise<string> {
  const head = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")
  if (head.trim()) return head.trim()
  for (const b of ["main", "master"]) {
    if (await git(cwd, ["rev-parse", "--verify", "--quiet", b]).then(() => true, () => false)) return b
  }
  throw new Error(`no base branch in ${cwd}: no origin/HEAD, main or master`)
}

/**
 * Branches matching a pattern such as `v1/*`, local first and then origin's, in stack order:
 * by name, with numbers compared as numbers (`v1/2-x` before `v1/10-y`).
 */
export async function matchingBranches(cwd: string, pattern: string): Promise<{ name: string; ref: string }[]> {
  const out = await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/heads/${pattern}`, `refs/remotes/origin/${pattern}`])
  const byName = new Map<string, string>()
  for (const ref of out.split("\n").filter(Boolean)) {
    const name = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "")
    if (!byName.has(name)) byName.set(name, ref)
  }
  return [...byName].map(([name, ref]) => ({ name, ref })).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
}

/** The merge on `base` that brought `ref` in: the first merge after it whose first parent does not hold it yet. */
async function mergeOf(cwd: string, ref: string, base: string): Promise<string | null> {
  const merges = (await git(cwd, ["rev-list", "--ancestry-path", "--merges", "--topo-order", "--reverse", `${ref}..${base}`])).split("\n").filter(Boolean)
  for (const m of merges) {
    const held = await git(cwd, ["merge-base", "--is-ancestor", ref, `${m}^1`]).then(() => true, () => false)
    if (!held) return m
  }
  return null
}

export async function branchWork(cwd: string, pattern: string, base?: string): Promise<BranchWork[]> {
  const from = base ?? (await baseBranch(cwd))
  const branches = await matchingBranches(cwd, pattern)
  const out: BranchWork[] = []
  const log = (ref: string, not: string[]) => git(cwd, ["log", "--no-merges", "--reverse", "--format=%H%x09%h%x09%aI%x09%s", ref, "--not", ...not])
  for (let i = 0; i < branches.length; i++) {
    const ref = branches[i]!.ref
    const earlier = branches.slice(0, i).map((b) => b.ref)
    let text = await log(ref, [from, ...earlier])
    if (!text.trim()) {
      const merge = await mergeOf(cwd, ref, from)
      if (merge) text = await log(ref, [`${merge}^1`, ...earlier])
    }
    const commits = text
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, short, at, ...subject] = l.split("\t")
        // The author's own date, so a commit made at 23:00 in Kigali stays on that day.
        return { hash: hash!, short: short!, at: at!, day: at!.slice(0, 10), subject: subject.join("\t") }
      })
    out.push({ branch: branches[i]!.name, commits })
  }
  return out
}
