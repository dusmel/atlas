import { describe, expect, test } from "bun:test";
import type { Item } from "../src/todo/format.ts";
import { ago, describe as describeEvent, listView, showView } from "../src/todo/pretty.ts";

let next = 1;
const item = (over: Partial<Item>): Item => ({
  id: next++,
  repo_name: "atlas",
  group_name: null,
  group_doc: null,
  parent_id: null,
  section: null,
  title: "A todo",
  body: "",
  status: "todo",
  priority: "P1",
  updated_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  ...over,
});

const plain = { width: 60, color: false };
const fits = (lines: string[], width: number) => lines.every((l) => Bun.stringWidth(l) <= width);

describe("listView", () => {
  const parent = item({ id: 10, title: "Phase 3: Board with a `drag-and-drop` layout", group_name: "Web v1", group_doc: "spec.html", status: "doing" });
  const items = [
    item({ id: 9, priority: null, title: "Triage me" }),
    parent,
    item({ id: 11, parent_id: 10, title: "First child", group_name: "Web v1" }),
    item({ id: 12, parent_id: 10, title: "Second child", group_name: "Web v1", status: "done" }),
    item({ id: 13, title: "x".repeat(200), group_name: "Web v1", group_doc: "spec.html" }),
    item({ id: 14, repo_name: "sem", priority: "P0", title: "Fix the reindex" }),
  ];

  const atlas = items.filter((i) => i.repo_name === "atlas");
  const open = (xs: Item[]) => xs.filter((i) => i.status !== "done");

  test("a repo gets a header with counts, a row per group, then a block per priority and group", () => {
    const out = listView(atlas, atlas, false, plain);
    expect(out[0]).toMatch(/^ atlas +3 todo · 1 doing · 1 done$/);
    expect(out[1]).toBe("━".repeat(60));
    expect(out[3]).toMatch(/^ {3}Web v1 +2 todo +1 doing +1 done +█+$/);
    expect(out[4]).toMatch(/^ {3}No group +1 todo +0 doing +0 done +█+$/);
    expect(out).toContain(" Inbox");
    expect(out.find((l) => l.startsWith(" P1"))).toMatch(/^ P1 {4}Web v1 +→ spec\.html$/);
  });

  test("the summary counts done items the outline leaves out", () => {
    const out = listView(atlas, open(atlas), false, plain);
    expect(out[0]).toEndWith("1 done");
    expect(out.some((l) => l.includes("#12"))).toBe(false);
    expect(listView(atlas, [], false, plain).at(-1)).toBe(" No todos match these filters.");
  });

  test("children sit under their parent, backticks go and long titles are cut to the width", () => {
    const out = listView(atlas, atlas, false, plain);
    const at = out.findLastIndex((l) => l.startsWith("   ◐ #10"));
    expect(out[at]).toBe("   ◐ #10  Phase 3: Board with a drag-and-drop layout");
    expect(out[at + 1]).toBe("     ├ ○ #11  First child");
    expect(out[at + 2]).toBe("     └ ● #12  Second child");
    expect(out[at + 3]).toEndWith("x…");
    expect(fits(out, 60)).toBe(true);
  });

  test("--all opens with a row per repo and what is in progress", () => {
    const out = listView(items, open(items), true, plain);
    expect(out[0]).toMatch(/^ All repos +4 todo · 1 doing · 1 done$/);
    expect(out.find((l) => l.startsWith("   atlas"))).toMatch(/^ {3}atlas +3 todo +1 doing +1 done +█+$/);
    expect(out.find((l) => l.startsWith("   sem"))).toMatch(/^ {3}sem +1 todo +0 doing +0 done +█+$/);
    const doing = out.indexOf(" Doing now");
    expect(out[doing + 2]).toMatch(/^ {3}◐ #10 {2}atlas {2}Phase 3/);
    expect(out.filter((l) => /^ (atlas|sem) /.test(l))).toHaveLength(2);
    expect(fits(out, 60)).toBe(true);
  });

  test("colour only when asked for", () => {
    expect(listView(items, items, true, plain).join("")).not.toContain("\x1b[");
    expect(listView(items, items, true, { width: 60, color: true }).join("")).toContain("\x1b[33m◐\x1b[39m");
  });

  test("**bold** loses its stars and keeps the weight", () => {
    const bold = [item({ id: 30, title: "**Only blocker left:** GPU quota" })];
    const out = listView(bold, bold, false, plain);
    expect(out).toContain("   ○ #30  Only blocker left: GPU quota");
    expect(listView(bold, bold, false, { width: 60, color: true }).join("")).toContain("\x1b[1mOnly blocker left:\x1b[22m");
  });

  test("an empty list says so", () => {
    expect(listView([], [], false, plain)).toEqual(["No todos."]);
  });
});

describe("showView", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const data = {
    item: item({ id: 65, title: "Phase 2: Todo store, merged with the importer and the `atlas todo` client", status: "done", body: "Shipped.\n- A bullet long enough to wrap onto a second line in a narrow terminal" }),
    children: [item({ id: 66, parent_id: 65, title: "Child" })],
    group: { name: "Web v1", doc_path: "spec.html" },
    events: [
      { at: "2026-10-05T10:00:00Z", actor: "cli:irembo-mac", action: "update", data: { status: ["doing", "done"], rank: ["a0", "az"], done_at: [null, "x"] } },
      { at: "2026-08-01T16:00:00Z", actor: "import", action: "import", data: { import_id: 1 } },
    ],
  };

  test("the title is boxed and wrapped, then the facts, body, children and history", () => {
    const out = showView(data, { width: 50, color: false }, now);
    expect(out[0]).toBe(`╭─ #65 ${"─".repeat(42)}╮`);
    expect(out[1]).toBe(`│ ${"Phase 2: Todo store, merged with the importer".padEnd(46)} │`);
    expect(out[2]).toBe(`│ ${"and the atlas todo client".padEnd(46)} │`);
    expect(out[3]).toBe(`╰${"─".repeat(48)}╯`);
    expect(out[4]).toBe("   P1  · ● done · atlas · Web v1");
    expect(out[5]).toBe("  plan  spec.html");
    expect(out).toContain("  - A bullet long enough to wrap onto a second");
    expect(out).toContain("    line in a narrow terminal");
    expect(out).toContain("  Children (1)");
    expect(out).toContain("    2h ago  cli:irembo-mac  doing → done");
    expect(out).toContain("    1 Aug   import          imported");
    expect(fits(out, 50)).toBe(true);
  });
});

describe("narrow terminals and long names", () => {
  const long = "Replace `guardrails-ai` with offline, auditable alternatives ".repeat(3);
  const items = [
    item({ id: 1, repo_name: "iremboai-chatbot-api-with-a-long-name", group_name: long, group_doc: "guardrails-replacement-plan-with-a-long-name.html", status: "doing" }),
    item({ id: 2, repo_name: "sem", group_name: "Short", status: "done" }),
    item({ id: 3, repo_name: "sem", priority: null, title: "y".repeat(300) }),
  ];
  const show = {
    item: item({ id: 1, title: long, status: "doing", section: long, archived_at: "x", body: `${" ".repeat(60)}- deep\n${long}` }),
    children: [item({ id: 2, parent_id: 1, title: long })],
    group: { name: long, doc_path: "a-very-long-plan-document-name-that-keeps-going-and-going.html" },
    events: [{ at: "2026-10-01T00:00:00Z", actor: `token:${"a".repeat(60)}`, action: "update", data: { status: ["todo", "doing"], priority: [null, "P1"], title: ["a", "b"], body: ["a", "b"], group_id: [1, 2], parent_id: [null, 3] } }],
  };

  for (const width of [40, 41, 60, 80, 120]) {
    test(`no line is wider than ${width} columns`, () => {
      for (const color of [false, true]) {
        const st = { width, color };
        const lines = [...listView(items, items, true, st), ...listView(items, items, false, st), ...showView(show, st)];
        const widest = Math.max(...lines.map((l) => Bun.stringWidth(l)));
        expect(widest).toBeLessThanOrEqual(width);
      }
    });
  }

  test("a plan link that does not fit moves to its own line", () => {
    const out = listView(items, items, false, { width: 60, color: false });
    const at = out.findIndex((l) => l.startsWith(" P1"));
    expect(out[at]).toEndWith("…");
    expect(out[at + 1]).toMatch(/^ +→ guardrails-replacement-plan/);
  });
});

describe("history wording", () => {
  const e = (action: string, data: unknown) => describeEvent({ at: "", actor: "", action, data });
  test("names what changed and hides bookkeeping fields", () => {
    expect(e("create", {})).toBe("created");
    expect(e("update", { priority: [null, "P1"], title: ["a", "b"] })).toBe("Inbox → P1, title changed");
    expect(e("move", { rank: ["a0", "a1"] })).toBe("moved");
    expect(e("archive", { archived_at: [null, "x"] })).toBe("archived");
    expect(e("unarchive", { archived_at: ["x", null], rank: ["a", "b"] })).toBe("unarchived");
    expect(e("update", { parent_id: [null, 4] })).toBe("child of #4");
  });

  test("ago", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(ago("2026-10-05T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-05T11:15:00Z", now)).toBe("45m ago");
    expect(ago("2026-10-03T12:00:00Z", now)).toBe("2d ago");
    expect(ago("2025-12-24T12:00:00Z", now)).toBe("24 Dec 2025");
  });
});
