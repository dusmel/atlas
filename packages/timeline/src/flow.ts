// The work around the build: brief, planning, exploration, sign-off, report, validation and fixes,
// deploy, scope change, investigation and merged. Each kind shows only when its activity happened,
// and each has a source besides run.md. Design: atlas/timeline/design.html#entries (T18, T23).
import type { Entry, Line, Pr, TodoItem } from "./build"
import type { BranchWork } from "./git"

/** A doc of the effort, from its meta tags. `path` is the html a line links to; `role` comes from its name. */
export type EffortDoc = { path: string; title: string; type: string | null; created: string | null; role?: "plan" | "design" | "report" | "brief" | null }
/** A session linked to the effort, with its day entries as GET /api/timeline?session= returns them. */
export type SessionDays = { id: string; days: Entry[] }

const DATE = /\b(20\d\d-\d\d-\d\d)\b/
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null)
const humanize = (slug: string) => {
  const s = slug.replace(/[-_]+/g, " ").trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
// A decision line is its first sentence, without markdown links or bold, short enough for one line.
const firstSentence = (text: string) => {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "")
  const s = plain.split(/(?<=[.!?])\s+(?=[A-Z])/)[0]!.replace(/\.$/, "")
  return s.length > 140 ? `${s.slice(0, 139).trimEnd()}…` : s
}

export type Decision = { id: string; text: string; day: string }

/** Decision-log rows with a lettered id (T18, O7) and a date. A bare number is an agent's default. */
export function readDecisions(design: string): Decision[] {
  const out: Decision[] = []
  let inLog = false
  for (const line of design.split("\n")) {
    if (/^#{2,3}\s/.test(line)) {
      inLog = /\{#decisions\}|decision log/i.test(line)
      continue
    }
    const m = inLog ? /^\|\s*([A-Z]{1,3}\d+)\s*\|\s*(.+?)\s*\|/.exec(line) : null
    const d = m && DATE.exec(line)
    if (m && d) out.push({ id: m[1]!, text: m[2]!, day: d[1]! })
  }
  return out
}

const SIGNOFF = /^(?:the\s+)?sign(?:ed)?[- ]?off\b/i

export type RunFlow = {
  rounds: { n: string; day: string; answers: number }[]
  signoff: string | null
  added: { text: string; day: string }[]
  /** Defaults picked, by the entry they belong to: `P3-x` is phase-3, `D-x` is the sign-off. */
  defaults: Map<string, number>
}

/** What run.md says about planning, sign-off and added scope. Loose like readRunMd: unknown lines are skipped. */
export function readRunFlow(text: string): RunFlow {
  const flow: RunFlow = { rounds: [], signoff: null, added: [], defaults: new Map() }
  let round: RunFlow["rounds"][number] | null = null
  for (const line of text.split("\n")) {
    const r = /^Round (\d+) \((20\d\d-\d\d-\d\d)\)/.exec(line)
    if (r) {
      round = { n: r[1]!, day: r[2]!, answers: 0 }
      flow.rounds.push(round)
      continue
    }
    if (round && /^\|\s*Q\d+\s*\|/.test(line)) round.answers++
    else if (round && line.trim() && !line.startsWith("|")) round = null
    const s = /^\|\s*\d+\.\s*Sign-off\s*\|\s*done\s+(20\d\d-\d\d-\d\d)/i.exec(line)
    if (s) flow.signoff ??= s[1]!
    const a = /^#+\s*(.+?)\s*\(added (20\d\d-\d\d-\d\d)\)/.exec(line)
    if (a) flow.added.push({ text: `${a[1]} added`, day: a[2]! })
    const d = /^\|\s*(?:P(\d+)|D)-[\w-]+\s*\|/.exec(line)
    if (d) {
      const key = d[1] ? `phase-${d[1]}` : "sign-off"
      flow.defaults.set(key, (flow.defaults.get(key) ?? 0) + 1)
    }
  }
  return flow
}

/** Canvas and mock-up links in the design, with the date written on the same line. */
export function readCanvases(design: string): { text: string; url: string; day: string | null }[] {
  const out: { text: string; url: string; day: string | null }[] = []
  for (const line of design.split("\n")) {
    for (const m of line.matchAll(/\[([^\]]*\b(?:canvas|board|mock-?ups?|prototype)\b[^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi)) {
      if (!out.some((c) => c.url === m[2])) out.push({ text: humanize(m[1]!), url: m[2]!, day: DATE.exec(line)?.[1] ?? null })
    }
  }
  return out
}

const RANK: Record<string, number> = { brief: 0, planning: 1, exploration: 2, "sign-off": 3, report: 5, validation: 6, deploy: 7, scope: 8, merged: 9 }
/** An entry's first day: its earliest line, since session times are UTC and a line's day is local. */
export const firstDay = (e: Entry) => e.lines.map((l) => l.day).filter((d): d is string => !!d).sort()[0] ?? (e.started_at ?? "").slice(0, 10)

/** Where an entry sits among the entries of its first day: the flow order, phases in the middle. */
export const flowRank = (id: string) => RANK[id.replace(/-20\d\d-\d\d-\d\d$/, "")] ?? 4

const STAND_IN = /^\d+ prompts?(, \d+ commits?)?$/
const DEPLOYED = /\bdeployed\b|\bdeploy(?:ed|ing)? (?:it )?to (?:prod|production)\b/i
const EXPLORED = /\b(?:canvas|prototype|mock-?ups?|artboards?)\b/i

export function addFlow(
  entries: Entry[],
  input: { work: BranchWork[]; todos: TodoItem[]; prs: Pr[]; design: string; runMd: string; docs: EffortDoc[]; sessions: SessionDays[]; unpushed: string[]; docPrefix: string | null },
): void {
  const byId = new Map(entries.map((e) => [e.entry, e]))
  const get = (id: string, title: string) => {
    let e = byId.get(id)
    if (!e) {
      e = { entry: id, state: "done", title, merged: false, lines: [], started_at: null, ended_at: null }
      entries.push(e)
      byId.set(id, e)
    }
    return e
  }
  const doc = (role: "plan" | "design" | "report") => input.docs.find((d) => (d.role !== undefined ? d.role === role : d.path === `${role}.html`))
  const decisions = readDecisions(input.design)
  const run = readRunFlow(input.runMd)
  const planAt = doc("plan")?.created ?? null
  const signed = decisions.find((d) => SIGNOFF.test(d.text))
  const signoffDay = signed?.day ?? run.signoff ?? dayOf(planAt)
  // On the plan's day, the sign-off is the plan's time; on a later day, that day.
  const signoffAt = signoffDay && planAt && dayOf(planAt) === signoffDay ? planAt : signoffDay
  const decisionLine = (d: Decision): Line => ({ day: d.day, text: `${d.id}: ${firstSentence(d.text)}`, source: "doc", ref: `${doc("design")?.path ?? "design.html"}#decisions`, kind: "decision" })

  // Sessions: keep the days from the first one about this effort. After sign-off, only days that touched
  // it: a session linked to two efforts would otherwise put its days for the other one here.
  const commits = new Map(input.work.flatMap((w) => w.commits.map((c) => [c.short, c] as const)))
  const todoIds = new Set(input.todos.map((t) => String(t.id)))
  const touches = (d: Entry) =>
    d.lines.some((l) => (l.source === "git" && l.ref && commits.has(l.ref)) || (l.source === "todo" && l.ref && todoIds.has(l.ref)) || (l.source === "doc" && input.docPrefix && l.text.startsWith(input.docPrefix)))
  const allDays = input.sessions.flatMap((s) => s.days.filter((d) => /^20\d\d-\d\d-\d\d$/.test(d.entry)).map((d) => ({ session: s.id, day: d })))
  const starts = [...allDays.filter((d) => touches(d.day)).map((d) => d.day.entry), dayOf(doc("design")?.created), dayOf(planAt), ...input.work.map((w) => w.commits[0]?.day)].filter((d): d is string => !!d).sort()
  const days = starts.length ? allDays.filter((d) => d.day.entry >= starts[0]! && ((signoffDay && d.day.entry <= signoffDay) || touches(d.day))).sort((a, b) => (a.day.started_at ?? "").localeCompare(b.day.started_at ?? "")) : []
  // Two sessions on one day: the day's title comes from the one that did more. A day with no digest
  // yet has a stand-in title ("17 prompts, 10 commits"), which names nothing.
  const title = new Map<string, { text: string; session: string }>()
  for (const d of days) {
    const had = title.get(d.day.entry)
    if (d.day.title && !STAND_IN.test(d.day.title) && (!had || d.day.lines.length > (days.find((x) => x.session === had.session && x.day.entry === d.day.entry)?.day.lines.length ?? 0))) title.set(d.day.entry, { text: d.day.title, session: d.session })
  }

  // Brief: the brief file, else what the first session day asked.
  const briefDoc = input.docs.find((d) => d.role === "brief" || (d.role === undefined && /brief/i.test(d.path)))
  const first = days[0]
  if (briefDoc) get("brief", "Brief").lines.push({ day: dayOf(briefDoc.created), text: briefDoc.title, source: "doc", ref: briefDoc.path, kind: "brief" })
  else if (first && (!signoffDay || first.day.entry <= signoffDay)) {
    const asked = first.day.lines.filter((l) => l.kind === "asked")
    const said = asked.length ? asked : STAND_IN.test(first.day.title) ? [] : [{ day: first.day.entry, text: first.day.title, source: "session" as const, ref: first.session, kind: "asked" }]
    if (said.length) {
      const b = get("brief", "Brief")
      b.started_at = first.day.started_at
      b.lines.push(...said)
    }
  }

  // Planning, up to sign-off: question rounds, the docs being written, the decisions made.
  const planning: Line[] = run.rounds.map((r) => ({ day: r.day, text: `Question round ${r.n}: ${r.answers} answers`, source: "run", ref: "run.md", kind: "planning" }))
  for (const [name, text] of [["design", "Design written"], ["plan", "Plan written"]] as const) {
    const d = doc(name)
    if (d?.created && (!signoffDay || dayOf(d.created)! <= signoffDay)) planning.push({ day: dayOf(d.created), text, source: "doc", ref: d.path, kind: "planning" })
  }
  for (const d of decisions) if (d !== signed && signoffDay && d.day <= signoffDay) planning.push(decisionLine(d))
  // A todo done before sign-off was planning work, whichever phase its day fell back on.
  for (const e of entries) {
    const doneAt = (l: Line) => input.todos.find((t) => String(t.id) === l.ref)?.done_at
    const early = e.lines.filter((l) => l.source === "todo" && !l.kind && signoffAt && doneAt(l) && Date.parse(doneAt(l)!) < Date.parse(signoffAt))
    if (!early.length) continue
    e.lines = e.lines.filter((l) => !early.includes(l))
    planning.push(...early)
  }
  if (planning.length) get("planning", "Planning").lines.push(...planning)

  // Exploration: canvases linked from the design, and the effort's other design pages.
  const explored: Line[] = readCanvases(input.design).map((c) => ({ day: c.day ?? dayOf(doc("design")?.created), text: c.text, source: "doc", ref: c.url, kind: "exploration" }))
  for (const d of input.docs) {
    if (d.type === "design" && d !== doc("design")) explored.push({ day: dayOf(d.created), text: d.title, source: "doc", ref: d.path, kind: "exploration" })
  }
  if (!explored.length) {
    for (const d of days) explored.push(...d.day.lines.filter((l) => (l.kind === "done" || l.kind === "decided") && EXPLORED.test(l.text)))
  }
  if (explored.length) get("exploration", "Exploration").lines.push(...explored)

  // Sign-off: the decision log's sign-off row, else run.md's step, else the plan being written.
  if (signoffDay) {
    const s = get("sign-off", "Sign-off")
    s.started_at = signoffAt
    s.lines.push(
      signed
        ? decisionLine(signed)
        : run.signoff
          ? { day: signoffDay, text: "Signed off", source: "run", ref: "run.md", kind: "sign-off" }
          : { day: signoffDay, text: "Signed off with the plan", source: "doc", ref: doc("plan")?.path ?? "plan.html", kind: "sign-off" },
    )
  }

  // Report: the end of an unattended run.
  const report = doc("report")
  if (report?.created) {
    const r = get("report", "Report")
    r.started_at = report.created
    r.lines.push({ day: dayOf(report.created), text: report.title, source: "doc", ref: report.path, kind: "report" })
  }

  // Validation and fixes: commits after the report on branches that started before it, and the days after it.
  const phaseDone = input.todos.filter((t) => /^Phase \d+\b/i.test(t.title))
  const anchor = report?.created ?? (phaseDone.length && phaseDone.every((t) => t.status === "done") ? phaseDone.map((t) => t.done_at ?? t.updated_at).sort().at(-1)! : null)
  const after = (at: string) => anchor !== null && Date.parse(at) > Date.parse(anchor)
  if (anchor) {
    for (const e of [...entries]) {
      if (!e.started_at || after(e.started_at) || e.entry === "report") continue
      const moved = e.lines.filter((l) => l.source === "git" && !l.kind && l.ref && commits.has(l.ref) && after(commits.get(l.ref)!.at))
      if (!moved.length) continue
      e.lines = e.lines.filter((l) => !moved.includes(l))
      const kept = e.lines.filter((l) => l.source === "git" && !l.kind && l.ref && commits.has(l.ref))
      e.ended_at = kept.length ? commits.get(kept.at(-1)!.ref!)!.at : e.ended_at
      const v = get("validation", "Validation and fixes")
      v.lines.push(...moved)
      v.started_at = [v.started_at, commits.get(moved[0]!.ref!)!.at].filter((x): x is string => !!x).sort()[0]!
    }
  }

  // Deploy: a session day that deployed, when timeline.md has no `done:` for it.
  if (!byId.get("deploy")?.lines.length) {
    const deployed = days.filter((d) => !signoffDay || d.day.entry >= signoffDay).flatMap((d) => d.day.lines.filter((l) => l.kind === "done" && DEPLOYED.test(l.text)))
    if (deployed.length) get("deploy", "Deploy").lines.push(...deployed)
  }

  // Scope change: decisions dated after sign-off, and phases run.md says were added, one entry per day.
  for (const d of decisions) if (signoffDay && d.day > signoffDay) get(`scope-${d.day}`, "Scope change").lines.push(decisionLine(d))
  for (const a of run.added) get(`scope-${a.day}`, "Scope change").lines.push({ day: a.day, text: a.text, source: "run", ref: "run.md", kind: "scope" })

  // Merged: the effort's PRs landing.
  const branches = new Set(input.work.map((w) => w.branch))
  for (const p of input.prs.filter((p) => p.state === "MERGED" && p.mergedAt && branches.has(p.branch)).sort((a, b) => a.mergedAt!.localeCompare(b.mergedAt!))) {
    const m = get("merged", "Merged")
    m.started_at ??= p.mergedAt
    m.lines.push({ day: dayOf(p.mergedAt), text: `PR ${p.number} merged`, source: "git", ref: p.url, kind: "merged" })
  }

  // Days of an entry: from its lines, else its start. A session day no entry covers lands in Planning
  // before sign-off and in Validation after the report.
  const spanOf = (e: Entry) => {
    const ds = e.lines.map((l) => l.day).filter((d): d is string => !!d).sort()
    return [ds[0] ?? dayOf(e.started_at), ds.at(-1) ?? dayOf(e.ended_at ?? e.started_at)] as const
  }
  for (const [day, t] of title) {
    const homes = entries.filter((e) => e.lines.some((l) => l.day === day && l.kind !== "day" && !l.kind?.startsWith("pr")))
    if (!homes.length) {
      if (signoffDay && day < signoffDay) homes.push(get("planning", "Planning"))
      else if (anchor && day > anchor.slice(0, 10)) homes.push(get("validation", "Validation and fixes"))
      else {
        const covering = entries.find((e) => e.state !== "todo" && (([a, b]) => !!a && !!b && a <= day && day <= b)(spanOf(e)))
        if (covering) homes.push(covering)
      }
    }
    for (const e of homes) {
      e.lines.push({ day, text: t.text, source: "session", ref: t.session, kind: "day" })
      if (!e.started_at || day < dayOf(e.started_at)!) e.started_at = days.find((d) => d.day.entry === day)?.day.started_at ?? day
    }
  }

  // Defaults picked on each phase, and on the sign-off for those picked there.
  for (const [id, n] of run.defaults) byId.get(id)?.lines.push({ day: null, text: `${n} ${n === 1 ? "default" : "defaults"} picked`, source: "run", ref: "run.md", kind: "defaults" })

  // A commit on no remote branch.
  const unpushed = new Set(input.unpushed)
  for (const e of entries) for (const l of e.lines) if (l.source === "git" && !l.kind && l.ref && unpushed.has(l.ref)) l.kind = "unpushed"
}

/**
 * Evidence on the entry it proves. A folder named for no entry is an investigation: a line on the
 * phase whose days cover it, else an entry of its own.
 */
export function addEvidence(entries: Entry[], evidence: { name: string; day: string }[]): void {
  for (const ev of evidence) {
    const line: Line = { day: ev.day, text: `Evidence: ${ev.name}`, source: "doc", ref: `evidence/${ev.name}/`, kind: "evidence" }
    const own = entries.find((e) => e.entry === ev.name)
    if (own) {
      own.lines.push(line)
      continue
    }
    // A phase's days are its commits' days, not the day its PR merged.
    const inside = entries.find((e) => {
      const ds = e.lines.filter((l) => l.source === "git" && (!l.kind || l.kind === "unpushed")).map((l) => l.day!).sort()
      return !!ds[0] && ds[0] <= ev.day && ev.day <= ds.at(-1)!
    })
    if (inside) inside.lines.push({ ...line, kind: "investigation" })
    else entries.push({ entry: `investigation-${ev.name}`, state: "done", title: `Investigation: ${humanize(ev.name).toLowerCase()}`, merged: false, lines: [{ ...line, kind: "investigation" }], started_at: null, ended_at: null })
  }
}
