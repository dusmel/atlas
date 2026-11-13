/**
 * `atlas timeline show` at a terminal: the web page's rail drawn in text. Pipes keep `showMarkdown`.
 * Design: atlas/timeline/design.html (T20).
 */

import { painter, type Style } from "./todo/pretty.ts";
import { lineSource, short, type ShownEntry } from "./timeline.ts";

const DOT: Record<string, { glyph: string; code: "green" | "yellow" | "red" | "dim" }> = {
  done: { glyph: "●", code: "green" },
  doing: { glyph: "◐", code: "yellow" },
  todo: { glyph: "○", code: "dim" },
  parked: { glyph: "◌", code: "red" },
};
const WHEN: Record<string, string> = { doing: "now", todo: "next", parked: "parked" };

/** A line of text never turns into a list or heading: a leading `-`, `#` or `1.` is escaped. */
const inline = (text: string) => text.replace(/^(>|(?:#{1,6}|[+*-]|\d+[.)])(?=\s|$))/, "\\$1");

/** Markdown wrapped to `width`. */
const md = (text: string, width: number, color: boolean): string[] =>
  Bun.markdown
    .ansi(text, { columns: Math.max(width, 20), colors: color, hyperlinks: color })
    .replace(/\n+$/, "")
    .split("\n");

function spanOf(e: ShownEntry): string | null {
  const days = e.lines.map((l) => l.day).filter((d): d is string => !!d).sort();
  const from = (e.started_at ?? days[0])?.slice(0, 10);
  const to = (e.ended_at ?? days.at(-1))?.slice(0, 10);
  if (!from || !to) return null;
  return from === to ? short(from) : `${short(from)} to ${short(to)}`;
}

/** The grey line at an entry's end, as on the web: commits and PRs, or how many items wait. */
function outcome(e: ShownEntry): string {
  if (e.state === "todo" || e.state === "parked") return e.lines.length ? `${e.lines.length} ${e.lines.length === 1 ? "item" : "items"}` : "";
  const commits = e.lines.filter((l) => l.source === "git" && (!l.kind || l.kind === "unpushed")).length;
  const prs = e.lines.filter((l) => l.kind?.startsWith("pr")).map((l) => l.text);
  return [commits ? `${commits} ${commits === 1 ? "commit" : "commits"}` : "", ...prs].filter(Boolean).join(" · ");
}

/** The rail, oldest first: a dot per entry, a solid line up to now and a dotted one after. */
export function railView(head: { name: string; sub: string }, entries: ShownEntry[], { width, color }: Style): string {
  const p = painter(color);
  const out = [p(head.name, "bold"), p(head.sub, "dim")];

  const waiting = entries.filter((e) => e.state !== "done").flatMap((e) => e.lines.filter((l) => l.kind === "waiting").map((l) => ({ e, l })));
  if (waiting.length) {
    out.push("", p("Waits on you", "bold", "yellow"));
    for (const { e, l } of waiting) md(inline(`${l.text} (${e.title})`), width - 4, color).forEach((s, i) => out.push(`${i ? "    " : p("  ▸ ", "yellow")}${s}`));
  }

  const doingAt = entries.findIndex((e) => e.state === "doing");
  const solidUntil = doingAt >= 0 ? doingAt : entries.map((e) => e.state).lastIndexOf("done");
  const inner = width - 3;
  entries.forEach((e, i) => {
    const last = i === entries.length - 1;
    const bar = last ? "   " : p(i < solidUntil ? "│  " : "┊  ", "dim");
    const dot = DOT[e.state] ?? DOT.todo!;
    const when = e.state === "done" ? spanOf(e) ?? "" : WHEN[e.state] ?? e.state;
    const tags = [e.merged ? p("merged", "magenta") : "", p(`id ${e.entry}`, "dim")].filter(Boolean).join(p(" · ", "dim"));
    out.push("", `${p(dot.glyph, dot.code)}  ${[when ? p(when, e.state === "doing" ? "yellow" : "dim") : "", tags].filter(Boolean).join(p(" · ", "dim"))}`);
    const push = (s: string) => out.push(`${bar}${s}`);
    md(inline(e.title), inner, color).forEach((s) => push(p(s, "bold")));
    if (e.note_state === "written" && e.note) md(e.note, inner, color).forEach(push);
    if (e.note_state === "draft") push(p("note: draft", "dim"));

    const all = e.lines.filter((l) => !l.kind?.startsWith("pr"));
    const onlyDays = all.every((l) => l.kind === "day");
    const titles = new Map(onlyDays ? [] : all.filter((l) => l.kind === "day").map((l) => [l.day, l.text]));
    // What waits on the owner leads the entry's lines.
    const lines = (onlyDays ? all : all.filter((l) => l.kind !== "day")).sort((a, b) => Number(b.kind === "waiting") - Number(a.kind === "waiting"));
    const split = new Set(lines.map((l) => l.day).filter(Boolean)).size > 1;
    let day: string | null | undefined;
    for (const l of lines) {
      if (split && l.day && l.day !== day) push(p(`${short(l.day)}${titles.has(l.day) ? `: ${titles.get(l.day)}` : ""}`, "dim"));
      day = l.day;
      const who = l.kind === "waiting" ? "**You:** " : "";
      const kind = l.kind && ["decision", "defaults", "parked"].includes(l.kind) ? ` · ${l.kind}` : "";
      const rows = md(`${who}${inline(l.text)}`, inner - 2, color);
      const src = p(`${lineSource(l)}${l.kind === "unpushed" ? " · not pushed" : kind}`, "dim");
      // The source goes after the text when it fits on the last row, else on a row of its own.
      const tail = rows.at(-1)!;
      if (Bun.stringWidth(tail) + 2 + Bun.stringWidth(src) <= inner - 2) rows[rows.length - 1] = `${tail}  ${src}`;
      else rows.push(src);
      rows.forEach((s, j) => push(`${j ? "  " : p("• ", "dim")}${s}`));
    }
    const o = outcome(e);
    if (o) push(p(o, "dim"));
  });
  return out.join("\n");
}
