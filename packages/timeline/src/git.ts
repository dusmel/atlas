// Reads an effort's branches from a local checkout. Each branch's commits are the ones no earlier
// branch in the stack and not the base branch has, so a stacked branch shows only its own work.

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

export async function branchWork(cwd: string, pattern: string, base?: string): Promise<BranchWork[]> {
  const from = base ?? (await baseBranch(cwd))
  const branches = await matchingBranches(cwd, pattern)
  const out: BranchWork[] = []
  for (let i = 0; i < branches.length; i++) {
    const not = [from, ...branches.slice(0, i).map((b) => b.ref)]
    const log = await git(cwd, ["log", "--no-merges", "--reverse", "--format=%H%x09%h%x09%aI%x09%s", branches[i]!.ref, "--not", ...not])
    const commits = log
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
