/**
 * Human output for `atlas todo`: one compact aligned line per item.
 */

import type { Report } from "@atlas/todos";

export type Item = {
  id: number;
  repo_name: string;
  group_name: string | null;
  parent_id: number | null;
  section: string | null;
  title: string;
  body: string;
  status: string;
  priority: string | null;
  updated_at: string;
  archived_at: string | null;
};

/** `P1  #42  doing  Build todo store   [Atlas Web v1]`, with a repo column for --all. */
export function itemLines(items: Item[], withRepo: boolean): string[] {
  const idWidth = Math.max(0, ...items.map((i) => String(i.id).length)) + 1;
  const repoWidth = Math.max(0, ...items.map((i) => i.repo_name.length));
  return items.map((i) => {
    const cols = [(i.priority ?? "In").padEnd(2), `#${i.id}`.padStart(idWidth), i.status.padEnd(5)];
    if (withRepo) cols.push(i.repo_name.padEnd(repoWidth));
    const group = i.group_name ? `   [${i.group_name}]` : "";
    return `${cols.join("  ")}  ${i.parent_id ? "↳ " : ""}${i.title}${group}`;
  });
}

export function showLines(data: { item: Item; children: Item[]; group: { name: string; doc_path: string | null } | null; events: { at: string; actor: string; action: string }[] }): string[] {
  const { item, children, group, events } = data;
  const out = [
    `#${item.id}  ${item.title}`,
    `  ${item.priority ?? "Inbox"} · ${item.status} · ${item.repo_name}${group ? ` · ${group.name}` : ""}${item.section ? ` · ${item.section}` : ""}${item.archived_at ? " · archived" : ""}`,
  ];
  if (item.parent_id) out.push(`  child of #${item.parent_id}`);
  if (group?.doc_path) out.push(`  plan: ${group.doc_path}`);
  if (item.body) out.push("", ...item.body.split("\n").map((l) => `  ${l}`));
  if (children.length) out.push("", "  children:", ...itemLines(children, false).map((l) => `    ${l}`));
  if (events.length) out.push("", "  history:", ...events.map((e) => `    ${e.at.slice(0, 16).replace("T", " ")}  ${e.actor}  ${e.action}`));
  return out;
}

const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function reportLines(r: Report): string[] {
  const s = r.by_status;
  const p = r.by_priority;
  const out = [
    `${r.repo.name}/${r.path}  ${r.ok ? "PASS" : "FAIL"}`,
    `  items ${r.items}: todo ${s.todo}, doing ${s.doing}, done ${s.done} · P0 ${p.P0}, P1 ${p.P1}, P2 ${p.P2}, P3 ${p.P3}, Inbox ${p.inbox}`,
    `  groups ${r.groups.length}: ${r.groups.join(", ")}`,
    `  children ${r.children}, flattened ${r.flattened.length}, preamble ${r.preamble.length} lines, separators ${r.separators.length}`,
  ];
  for (const m of r.mappings) out.push(`  mapped: line ${m.line} "${m.text}" → ${m.to === "P3" ? "P3" : "Inbox"}`);
  for (const m of r.merged) out.push(`  merged: line ${m.line} "${m.text}" into the earlier group of that name`);
  for (const f of r.flattened) out.push(`  flattened: line ${f.line} ${clip(f.text)}`);
  for (const f of r.failures) out.push(`  ${f.check}: ${f.line ? `line ${f.line} ` : ""}${f.message}${f.text ? `: ${clip(f.text)}` : ""}`);
  return out;
}
