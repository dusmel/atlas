/**
 * Output for a person at a terminal: `list` as an outline with counts, `show` as a card.
 * Pipes and --plain keep the one-line format from format.ts, which agents read.
 */

import type { Item } from "./format.ts";

export type Style = { width: number; color: boolean };

type ShowData = {
  item: Item;
  children: Item[];
  group: { name: string; doc_path: string | null } | null;
  events: { at: string; actor: string; action: string; data?: unknown }[];
};

const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  inverse: [7, 27],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
} as const;
type Code = keyof typeof CODES;

const painter = (color: boolean) => (s: string, ...codes: Code[]) =>
  color && s ? codes.reduce((out, c) => `\x1b[${CODES[c][0]}m${out}\x1b[${CODES[c][1]}m`, s) : s;

const STATUS: Record<string, { glyph: string; code: Code | null }> = {
  todo: { glyph: "○", code: null },
  doing: { glyph: "◐", code: "yellow" },
  done: { glyph: "●", code: "green" },
};
const PRIORITY: Record<string, Code> = { P0: "red", P1: "yellow", P2: "blue", P3: "dim" };
const STATUS_ORDER = ["todo", "doing", "done"];

// Text as cells, so width, cutting and wrapping ignore the marks for `code` and **bold**.
type Cell = { ch: string; code: boolean; bold: boolean };

function cells(text: string): Cell[] {
  const out: Cell[] = [];
  const chars = Array.from(text);
  let code = false;
  let bold = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === "`") code = !code;
    else if (ch === "*" && chars[i + 1] === "*" && !code) {
      bold = !bold;
      i++;
    } else out.push({ ch, code, bold });
  }
  return out;
}

const widthOf = (cs: Cell[]) => cs.reduce((n, c) => n + Bun.stringWidth(c.ch), 0);

function fit(cs: Cell[], max: number): Cell[] {
  if (widthOf(cs) <= max) return cs;
  const out: Cell[] = [];
  let w = 0;
  for (const c of cs) {
    const cw = Bun.stringWidth(c.ch);
    if (w + cw > max - 1) break;
    out.push(c);
    w += cw;
  }
  return [...out, { ch: "…", code: false, bold: false }];
}

function wrap(cs: Cell[], max: number): Cell[][] {
  const lines: Cell[][] = [];
  let line: Cell[] = [];
  let word: Cell[] = [];
  const flush = () => {
    if (!word.length) return;
    if (line.length && widthOf(line) + 1 + widthOf(word) > max) {
      lines.push(line);
      line = [];
    }
    if (line.length) line.push({ ch: " ", code: false, bold: false });
    for (const c of word) {
      if (widthOf(line) + Bun.stringWidth(c.ch) > max) {
        lines.push(line);
        line = [];
      }
      line.push(c);
    }
    word = [];
  };
  for (const c of cs) {
    if (c.ch === " " && !c.code) flush();
    else word.push(c);
  }
  flush();
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

function render(cs: Cell[], paint: ReturnType<typeof painter>, ...base: Code[]): string {
  let out = "";
  let i = 0;
  while (i < cs.length) {
    const { code, bold } = cs[i]!;
    let run = "";
    while (i < cs.length && cs[i]!.code === code && cs[i]!.bold === bold) run += cs[i++]!.ch;
    out += code ? paint(run, "cyan") : paint(run, ...base, ...(bold ? (["bold"] as Code[]) : []));
  }
  return out;
}

/** `left` and `right` on one line, `right` pushed to the edge when there is room. */
function spread(left: string, leftWidth: number, right: string, rightWidth: number, width: number): string {
  if (!right) return left;
  return leftWidth + 2 + rightWidth > width ? `${left}  ${right}` : `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
}

function counts(items: Item[]): { text: string; width: number; render: (paint: ReturnType<typeof painter>) => string } {
  const parts = STATUS_ORDER.map((s) => ({ s, n: items.filter((i) => i.status === s).length })).filter((p) => p.n);
  const text = parts.map((p) => `${p.n} ${p.s}`).join(" · ");
  return {
    text,
    width: Bun.stringWidth(text),
    render: (paint) => parts.map((p) => paint(`${p.n} ${p.s}`, ...(STATUS[p.s]!.code ? [STATUS[p.s]!.code!] : []))).join(paint(" · ", "dim")),
  };
}

const priorityLabel = (p: string | null) => p ?? "Inbox";
const priorityCode = (p: string | null): Code => (p ? PRIORITY[p]! : "magenta");

function glyph(status: string, paint: ReturnType<typeof painter>): string {
  const s = STATUS[status] ?? STATUS.todo!;
  return s.code ? paint(s.glyph, s.code) : s.glyph;
}

/** One repo: a header with counts, then a block per priority and group, children under their parent. */
function repoSection(name: string, items: Item[], st: Style, paint: ReturnType<typeof painter>): string[] {
  const c = counts(items);
  const out = [spread(` ${paint(name, "bold")}`, 1 + Bun.stringWidth(name), c.render(paint), c.width, st.width), paint("━".repeat(st.width), "dim")];

  const ids = new Set(items.map((i) => i.id));
  const children = new Map<number, Item[]>();
  for (const i of items) if (i.parent_id && ids.has(i.parent_id)) children.set(i.parent_id, [...(children.get(i.parent_id) ?? []), i]);
  const blocks = new Map<string, Item[]>();
  for (const i of items) {
    if (i.parent_id && ids.has(i.parent_id)) continue;
    const key = `${i.priority}\n${i.group_name ?? ""}`;
    blocks.set(key, [...(blocks.get(key) ?? []), i]);
  }

  const idWidth = Math.max(...items.map((i) => String(i.id).length)) + 1;
  const line = (i: Item, lead: string, leadWidth: number) => {
    const id = `#${i.id}`.padEnd(idWidth);
    const room = st.width - leadWidth - 2 - idWidth - 2;
    const title = render(fit(cells(i.title), room), paint, ...(i.status === "done" ? (["dim"] as Code[]) : []));
    return `${lead}${glyph(i.status, paint)} ${paint(id, "dim")}  ${title}`;
  };

  for (const block of blocks.values()) {
    const first = block[0]!;
    const label = priorityLabel(first.priority);
    const group = first.group_name ?? "";
    const left = ` ${paint(label.padEnd(5), priorityCode(first.priority), "bold")}${group ? ` ${paint(group, "bold")}` : ""}`;
    const doc = first.group_doc ? `→ ${first.group_doc}` : "";
    out.push("", spread(left, 6 + (group ? 1 + Bun.stringWidth(group) : 0), paint(doc, "dim"), Bun.stringWidth(doc), st.width));
    out.push(` ${paint("─".repeat(st.width - 1), "dim")}`);
    for (const i of block) {
      out.push(line(i, "   ", 3));
      const kids = children.get(i.id) ?? [];
      kids.forEach((k, n) => out.push(line(k, `     ${paint(n === kids.length - 1 ? "└" : "├", "dim")} `, 7)));
    }
  }
  return out;
}

/** `atlas todo list` at a terminal. With --all, a summary of every repo comes first. */
export function listView(items: Item[], all: boolean, st: Style): string[] {
  const paint = painter(st.color);
  if (!items.length) return ["No todos."];
  const repos = new Map<string, Item[]>();
  for (const i of items) repos.set(i.repo_name, [...(repos.get(i.repo_name) ?? []), i]);
  const ordered = [...repos.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!all) return ordered.flatMap(([name, xs]) => repoSection(name, xs, st, paint));

  const c = counts(items);
  const out = [spread(` ${paint("All repos", "bold")}`, 10, c.render(paint), c.width, st.width), paint("━".repeat(st.width), "dim"), ""];
  const nameWidth = Math.max(...ordered.map(([n]) => Bun.stringWidth(n)));
  const shown = STATUS_ORDER.filter((s) => items.some((i) => i.status === s));
  const most = ordered[0]![1].length;
  const barRoom = Math.max(8, st.width - 3 - nameWidth - shown.length * 10 - 2);
  const scale = (n: number) => Math.round((n / most) * barRoom);
  for (const [name, xs] of ordered) {
    const cols = shown.map((s) => `${String(xs.filter((i) => i.status === s).length).padStart(4)} ${s.padEnd(5)}`).join("");
    // Segments from running totals, so rounding never makes a bar longer than the room.
    let before = 0;
    const bar = shown
      .map((s) => {
        const n = xs.filter((i) => i.status === s).length;
        const seg = scale(before + n) - scale(before);
        before += n;
        return paint("█".repeat(seg), ...(STATUS[s]!.code ? [STATUS[s]!.code!] : ["dim" as Code]));
      })
      .join("");
    out.push(`   ${name.padEnd(nameWidth)}${cols}  ${bar}`);
  }

  const doing = items.filter((i) => i.status === "doing");
  if (doing.length) {
    out.push("", ` ${paint("Doing now", "bold")}`, ` ${paint("─".repeat(st.width - 1), "dim")}`);
    const idWidth = Math.max(...doing.map((i) => String(i.id).length)) + 1;
    for (const i of doing) {
      const room = st.width - 5 - idWidth - 2 - nameWidth - 2;
      out.push(`   ${glyph("doing", paint)} ${paint(`#${i.id}`.padEnd(idWidth), "dim")}  ${i.repo_name.padEnd(nameWidth)}  ${render(fit(cells(i.title), room), paint)}`);
    }
  }
  for (const [name, xs] of ordered) out.push("", "", ...repoSection(name, xs, st, paint));
  return out;
}

export function ago(at: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(at)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

const QUIET = new Set(["rank", "done_at", "updated_at", "archived_at"]);

/** What an event changed, from the `[old, new]` pairs the server stores. */
export function describe(e: ShowData["events"][number]): string {
  if (e.action === "create") return "created";
  if (e.action === "import") return "imported";
  if (e.action === "archive") return "archived";
  if (e.action === "unarchive") return "unarchived";
  const data = e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {};
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (QUIET.has(k) || !Array.isArray(v) || v.length !== 2) continue;
    const [from, to] = v as [unknown, unknown];
    if (k === "status") parts.push(`${from} → ${to}`);
    else if (k === "priority") parts.push(`${priorityLabel(from as string | null)} → ${priorityLabel(to as string | null)}`);
    else if (k === "parent_id") parts.push(to === null ? "no parent" : `child of #${to}`);
    else parts.push(`${k.replace(/_id$/, "")} changed`);
  }
  if (parts.length) return parts.join(", ");
  return e.action === "move" || "rank" in data ? "moved" : e.action;
}

/** `atlas todo show` at a terminal: the title in a box, then facts, body, children and history. */
export function showView(data: ShowData, st: Style, now = Date.now()): string[] {
  const paint = painter(st.color);
  const { item, children, group, events } = data;
  const width = Math.min(st.width, 100);
  const inner = width - 4;

  const id = ` #${item.id} `;
  const out = [paint(`╭─${id}${"─".repeat(Math.max(0, width - 3 - id.length))}╮`, "dim")];
  for (const l of wrap(cells(item.title), inner)) out.push(`${paint("│", "dim")} ${render(l, paint, "bold")}${" ".repeat(inner - widthOf(l))} ${paint("│", "dim")}`);
  out.push(paint(`╰${"─".repeat(width - 2)}╯`, "dim"));

  const sep = paint(" · ", "dim");
  const facts = [
    paint(` ${priorityLabel(item.priority)} `, priorityCode(item.priority), "inverse"),
    `${glyph(item.status, paint)} ${item.status}`,
    paint(item.repo_name, "bold"),
    ...(group ? [group.name] : []),
    ...(item.section ? [item.section] : []),
    ...(item.archived_at ? [paint("archived", "red")] : []),
  ];
  out.push(`  ${facts.join(sep)}`);
  if (group?.doc_path) out.push(`  ${paint("plan", "dim")}  ${group.doc_path}`);
  if (item.parent_id) out.push(`  ${paint("child of", "dim")}  #${item.parent_id}`);

  if (item.body) {
    out.push("");
    for (const raw of item.body.split("\n")) {
      const indent = raw.length - raw.trimStart().length;
      const hang = indent + (/^\s*[-*] /.test(raw) ? 2 : 0);
      wrap(cells(raw.trimStart()), inner - hang).forEach((l, n) => out.push(`  ${" ".repeat(n ? hang : indent)}${render(l, paint)}`));
    }
  }

  const heading = (title: string) => out.push("", `  ${paint(title, "bold")}`, `  ${paint("─".repeat(width - 2), "dim")}`);
  if (children.length) {
    heading(`Children (${children.length})`);
    const idWidth = Math.max(...children.map((c) => String(c.id).length)) + 1;
    for (const c of children) {
      const title = render(fit(cells(c.title), width - 8 - idWidth), paint, ...(c.status === "done" ? (["dim"] as Code[]) : []));
      out.push(`    ${glyph(c.status, paint)} ${paint(`#${c.id}`.padEnd(idWidth), "dim")}  ${title}`);
    }
  }
  if (events.length) {
    heading("History");
    const when = events.map((e) => ago(e.at, now));
    const whenWidth = Math.max(...when.map((w) => w.length));
    const actorWidth = Math.max(...events.map((e) => e.actor.length));
    events.forEach((e, n) => out.push(`    ${paint(when[n]!.padEnd(whenWidth), "dim")}  ${e.actor.padEnd(actorWidth)}  ${describe(e)}`));
  }
  return out;
}
