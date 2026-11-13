import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effortDocs } from "../src/timeline.ts";

const page = (title: string, type: string, date: string, key = "created") => `<head><title>${title}</title><meta name="doc-type" content="${type}"><meta name="${key}" content="${date}"></head>`;

test("an effort folder's docs get their role from their name", () => {
  const dir = mkdtempSync(join(tmpdir(), "effort-"));
  writeFileSync(join(dir, "plan.html"), page("The plan", "plan", "2026-11-12T19:56+02:00"));
  writeFileSync(join(dir, "design.html"), page("The design", "design", "2026-11-12T19:55+02:00"));
  writeFileSync(join(dir, "finding-marks.html"), page("Finding marks", "design", "2026-11-12T17:22+02:00"));
  writeFileSync(join(dir, "index.html"), page("Index", "index", "2026-11-12"));
  const docs = effortDocs(dir).sort((a, b) => a.path.localeCompare(b.path));
  expect(docs.map((d) => [d.path, d.role])).toEqual([["design.html", "design"], ["finding-marks.html", null], ["plan.html", "plan"]]);
});

test("a plan in a shared folder takes only the docs named like it, and its spec is the design", () => {
  const dir = mkdtempSync(join(tmpdir(), "flat-"));
  writeFileSync(join(dir, "object-storage-plan.html"), page("Audio storage for ASR and TTS", "plan", "2026-09-30", "date"));
  writeFileSync(join(dir, "object-storage-spec.html"), page("Audio storage spec", "reference", "2026-09-30", "date"));
  writeFileSync(join(dir, "telephony-architecture.html"), page("Telephony", "design", "2026-10-01"));
  const docs = effortDocs(dir, "object-storage-plan.html").sort((a, b) => a.path.localeCompare(b.path));
  expect(docs).toEqual([
    { path: "object-storage-plan.html", title: "Audio storage for ASR and TTS", type: "plan", created: "2026-09-30", role: "plan" },
    { path: "object-storage-spec.html", title: "Audio storage spec", type: "reference", created: "2026-09-30", role: "design" },
  ]);
});
