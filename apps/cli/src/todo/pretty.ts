/**
 * Output for a person at a terminal: `list` as an outline with counts, `show` as a card.
 * Pipes and --plain keep the one-line format from format.ts, which agents read.
 */

import type { Item } from "./format.ts";

export type Style = { width: number; color: boolean };

/** Narrower than this, the CLI prints the plain one-line format instead. */
export const MIN_WIDTH = 40;

type ShowData = {
  item: Item;
  children: Item[];
  group: { name: string; doc_path: string | null } | null;
  events: { at: string; actor: string; author?: string | null; action: string; data?: unknown }[];
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

/**
 * `name` after `prefix`, with `right` pushed to the edge. When they do not fit on one line,
 * `right` moves to a line of its own and `name` is cut to the width.
 */
function spread(prefix: string, prefixWidth: number, name: Cell[], right: string, rightWidth: number, st: Style, paint: ReturnType<typeof painter>, ...codes: Code[]): string[] {
  const nameWidth = widthOf(name);
  if (prefixWidth + nameWidth + 2 + rightWidth <= st.width) {
    const gap = right ? " ".repeat(st.width - prefixWidth - nameWidth - rightWidth) : "";
    return [`${prefix}${render(name, paint, ...codes)}${gap}${right}`];
  }
  const first = `${prefix}${render(fit(name, st.width - prefixWidth), paint, ...codes)}`;
  return right ? [first, `${" ".repeat(Math.max(0, st.width - rightWidth))}${right}`] : [first];
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
const authorLabel = (i: Item) => i.created_by ?? "unknown";
const isAgent = (author: string) => !["me", "script", "import", "unknown"].includes(author);

/** Who made each item, as a column at the end of its line: agents in colour, the rest dim. */
function tags(items: Item[], room: number, paint: ReturnType<typeof painter>) {
  const width = Math.min(14, Math.max(...items.map((i) => authorLabel(i).length)));
  // Leave the title at least 12 columns; a narrower terminal drops the column.
  const shown = room - (width + 3) >= 12;
  return {
    width: shown ? width + 3 : 0,
    of: (i: Item, titleWidth: number, titleRoom: number) => {
      if (!shown) return "";
      const label = fit(cells(authorLabel(i)), width);
      return `${" ".repeat(titleRoom - titleWidth)}${paint(" · ", "dim")}${paint(render(label, paint), isAgent(authorLabel(i)) ? "blue" : "dim")}`;
    },
  };
}
const priorityCode = (p: string | null): Code => (p ? PRIORITY[p]! : "magenta");

function glyph(status: string, paint: ReturnType<typeof painter>): string {
  const s = STATUS[status] ?? STATUS.todo!;
  return s.code ? paint(s.glyph, s.code) : s.glyph;
}

/** A bold title with counts on the right, over a heavy rule. */
function header(title: string, items: Item[], st: Style, paint: ReturnType<typeof painter>): string[] {
  const c = counts(items);
  return [...spread(" ", 1, cells(title), c.render(paint), c.width, st, paint, "bold"), paint("━".repeat(st.width), "dim")];
}

/** A block per priority and group, children under their parent. */
function blocks(items: Item[], st: Style, paint: ReturnType<typeof painter>): string[] {
  const out: string[] = [];
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<number, Item[]>();
  for (const i of items) if (i.parent_id && ids.has(i.parent_id)) children.set(i.parent_id, [...(children.get(i.parent_id) ?? []), i]);
  const byLane = new Map<string, Item[]>();
  for (const i of items) {
    if (i.parent_id && ids.has(i.parent_id)) continue;
    const key = `${i.priority}\n${i.group_name ?? ""}`;
    byLane.set(key, [...(byLane.get(key) ?? []), i]);
  }

  const idWidth = Math.max(...items.map((i) => String(i.id).length)) + 1;
  const tag = tags(items, st.width - 7 - 2 - idWidth - 2, paint);
  const line = (i: Item, lead: string, leadWidth: number) => {
    const id = `#${i.id}`.padEnd(idWidth);
    const room = st.width - leadWidth - 2 - idWidth - 2 - tag.width;
    const cut = fit(cells(i.title), room);
    const title = render(cut, paint, ...(i.status === "done" ? (["dim"] as Code[]) : []));
    return `${lead}${glyph(i.status, paint)} ${paint(id, "dim")}  ${title}${tag.of(i, widthOf(cut), room)}`;
  };

  for (const block of byLane.values()) {
    const first = block[0]!;
    const label = priorityLabel(first.priority);
    const group = first.group_name ?? "";
    const prefix = ` ${paint(label.padEnd(5), priorityCode(first.priority), "bold")}${group ? " " : ""}`;
    const doc = first.group_doc ? fit(cells(`→ ${first.group_doc}`), st.width) : [];
    out.push("", ...spread(prefix, group ? 7 : 6, cells(group), render(doc, paint, "dim"), widthOf(doc), st, paint, "bold"));
    out.push(` ${paint("─".repeat(st.width - 1), "dim")}`);
    for (const i of block) {
      out.push(line(i, "   ", 3));
      const kids = children.get(i.id) ?? [];
      kids.forEach((k, n) => out.push(line(k, `     ${paint(n === kids.length - 1 ? "└" : "├", "dim")} `, 7)));
    }
  }
  return out;
}

const bucket = (items: Item[], key: (i: Item) => string) => {
  const m = new Map<string, Item[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
};

/** A row per repo or group: counts for every status, and a bar of done, doing and todo. */
function summaryRows(rows: [string, Item[]][], st: Style, paint: ReturnType<typeof painter>): string[] {
  const fixed = 3 + STATUS_ORDER.length * 10;
  const longest = Math.max(...rows.map(([n]) => widthOf(cells(n))));
  // The name gets up to 40% of the width. A bar shorter than 8 says nothing, so a narrow
  // terminal drops it and gives the name the room instead.
  const named = Math.min(longest, Math.floor(st.width * 0.4));
  const barRoom = st.width - fixed - named - 2 >= 8 ? st.width - fixed - named - 2 : 0;
  const nameWidth = barRoom ? named : Math.min(longest, st.width - fixed);
  const most = Math.max(...rows.map(([, xs]) => xs.length));
  const scale = (n: number) => Math.round((n / most) * barRoom);
  return rows.map(([name, xs]) => {
    const n = (s: string) => xs.filter((i) => i.status === s).length;
    const cols = STATUS_ORDER.map((s) => `${String(n(s)).padStart(4)} ${s.padEnd(5)}`).join("");
    // Segments from running totals, so rounding never makes a bar longer than the room.
    let before = 0;
    const bar = ["done", "doing", "todo"]
      .map((s) => {
        const seg = scale(before + n(s)) - scale(before);
        before += n(s);
        return paint("█".repeat(seg), ...(STATUS[s]!.code ? [STATUS[s]!.code!] : ["dim" as Code]));
      })
      .join("");
    const label = fit(cells(name), nameWidth);
    return `   ${render(label, paint)}${" ".repeat(nameWidth - widthOf(label))}${cols}${barRoom ? `  ${bar}` : ""}`;
  });
}

function doingNow(items: Item[], withRepo: boolean, st: Style, paint: ReturnType<typeof painter>): string[] {
  const doing = items.filter((i) => i.status === "doing");
  if (!doing.length) return [];
  const out = ["", ` ${paint("Doing now", "bold")}`, ` ${paint("─".repeat(st.width - 1), "dim")}`];
  const idWidth = Math.max(...doing.map((i) => String(i.id).length)) + 1;
  const repoWidth = withRepo ? Math.min(Math.max(...doing.map((i) => i.repo_name.length)), Math.floor(st.width * 0.3)) + 2 : 0;
  const tag = tags(doing, st.width - 5 - idWidth - 2 - repoWidth, paint);
  for (const i of doing) {
    const r = fit(cells(i.repo_name), repoWidth - 2);
    const repo = withRepo ? `${render(r, paint)}${" ".repeat(repoWidth - widthOf(r))}` : "";
    const room = st.width - 5 - idWidth - 2 - repoWidth - tag.width;
    const cut = fit(cells(i.title), room);
    out.push(`   ${glyph("doing", paint)} ${paint(`#${i.id}`.padEnd(idWidth), "dim")}  ${repo}${render(cut, paint)}${tag.of(i, widthOf(cut), room)}`);
  }
  return out;
}

/**
 * `atlas todo list` at a terminal. The summary counts `everything` (all statuses), the
 * outline shows only `shown`, which is what --status asked for.
 */
export function listView(everything: Item[], shown: Item[], all: boolean, st: Style): string[] {
  const paint = painter(st.color);
  if (!everything.length) return ["No todos."];
  const out = header(all ? "All repos" : everything[0]!.repo_name, everything, st, paint);
  const rows = all ? bucket(everything, (i) => i.repo_name) : bucket(everything, (i) => i.group_name ?? "No group");
  out.push("", ...summaryRows(rows, st, paint), ...doingNow(everything, all, st, paint));
  if (!shown.length) return [...out, "", " No todos match these filters."];
  if (!all) return [...out, ...blocks(shown, st, paint)];
  for (const [name] of rows) {
    const repoShown = shown.filter((i) => i.repo_name === name);
    if (repoShown.length) out.push("", "", ...header(name, everything.filter((i) => i.repo_name === name), st, paint), ...blocks(repoShown, st, paint));
  }
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

  // Facts as [text, width], laid out left to right and wrapped onto more lines when needed.
  const text = (s: string, ...codes: Code[]): [string, number] => {
    const c = fit(cells(s), width - 2);
    return [render(c, paint, ...codes), widthOf(c)];
  };
  const priority = ` ${priorityLabel(item.priority)} `;
  const facts: [string, number][] = [
    [paint(priority, priorityCode(item.priority), "inverse"), priority.length],
    [`${glyph(item.status, paint)} ${item.status}`, 2 + item.status.length],
    text(item.repo_name, "bold"),
    ...(group ? [text(group.name)] : []),
    ...(item.section ? [text(item.section)] : []),
    text(`by ${authorLabel(item)}`, ...(isAgent(authorLabel(item)) ? (["blue"] as Code[]) : [])),
    ...(item.archived_at ? [text("archived", "red")] : []),
  ];
  let row = "";
  let used = 2;
  for (const [s, w] of facts) {
    if (row && used + 3 + w > width) {
      out.push(`  ${row}`);
      row = "";
      used = 2;
    }
    row += row ? `${paint(" · ", "dim")}${s}` : s;
    used += (used > 2 ? 3 : 0) + w;
  }
  out.push(`  ${row}`);
  if (group?.doc_path) out.push(`  ${paint("plan", "dim")}  ${render(fit(cells(group.doc_path), width - 8), paint)}`);
  if (item.parent_id) out.push(`  ${paint("child of", "dim")}  #${item.parent_id}`);

  if (item.body) {
    out.push("");
    for (const raw of item.body.split("\n")) {
      const indent = raw.length - raw.trimStart().length;
      const hang = Math.min(indent + (/^\s*[-*] /.test(raw) ? 2 : 0), Math.floor(inner / 2));
      wrap(cells(raw.trimStart()), inner - hang).forEach((l, n) => out.push(`  ${" ".repeat(n ? hang : Math.min(indent, hang))}${render(l, paint)}`));
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
    // Who made the change; events from before authors were kept only know where it came from.
    const who = events.map((e) => e.author ?? e.actor);
    const actorWidth = Math.min(Math.max(...who.map((w) => widthOf(cells(w)))), Math.floor(width * 0.3));
    const lead = 4 + whenWidth + 2 + actorWidth + 2;
    events.forEach((e, n) => {
      const actor = fit(cells(who[n]!), actorWidth);
      const [first, ...more] = wrap(cells(describe(e)), width - lead);
      out.push(`    ${paint(when[n]!.padEnd(whenWidth), "dim")}  ${render(actor, paint)}${" ".repeat(actorWidth - widthOf(actor))}  ${render(first!, paint)}`);
      for (const l of more) out.push(`${" ".repeat(lead)}${render(l, paint)}`);
    });
  }
  return out;
}
