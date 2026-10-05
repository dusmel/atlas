/**
 * `atlas todo import`: dry run by default, `--apply` sends each passing file to the
 * server and then checks what it stored (spec section 11).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkFile, checkStored, report, type Report } from "@atlas/todos";
import { reposDir } from "../config.ts";
import { out } from "../util.ts";
import { api, CliError, type Config } from "./client.ts";
import { reportLines } from "./format.ts";
import { metaOf } from "./scope.ts";

export type TodoFile = { repo: { id: string; name: string }; path: string; file: string };

/** Every TODO.md in a store dir or its plans/, any case (sem has todo.md), skipping legacy-md/. */
export function findTodoFiles(only?: string): TodoFile[] {
  const files: TodoFile[] = [];
  for (const name of readdirSync(reposDir()).sort()) {
    const dir = join(reposDir(), name);
    if ((only && name !== only) || !statSync(dir).isDirectory()) continue;
    const meta = metaOf(dir);
    if (!meta) continue;
    for (const sub of [dir, join(dir, "plans")]) {
      let entries: string[];
      try {
        entries = readdirSync(sub);
      } catch {
        continue;
      }
      for (const e of entries.filter((e) => /^todo\.md$/i.test(e))) {
        const file = join(sub, e);
        if (file.includes("legacy-md/")) continue;
        files.push({ repo: { id: meta.id, name }, path: relative(dir, file), file });
      }
    }
  }
  return files;
}

type Result = { report: Report; applied?: { import_id: number; stored_check: Report["failures"] }; error?: string };

export async function importTodos(cfg: Config | null, opts: { apply: boolean; repo?: string; json: boolean }): Promise<number> {
  const files = findTodoFiles(opts.repo);
  if (!files.length) throw new CliError(1, `No TODO.md found under ${reposDir()}${opts.repo ? `/${opts.repo}` : ""}`);
  const results: Result[] = [];
  for (const f of files) {
    const original = readFileSync(f.file, "utf8");
    const { parsed, failures } = checkFile(original);
    const result: Result = { report: report(f.path, f.repo, parsed, failures) };
    results.push(result);
    if (!opts.apply || !result.report.ok) continue;
    try {
      const { import_id } = await api<{ import_id: number }>(cfg!, "POST", "/imports", { repo: f.repo, path: f.path, original });
      const stored = await api<Parameters<typeof checkStored>[1]>(cfg!, "GET", `/imports/${import_id}`);
      result.applied = { import_id, stored_check: checkStored(parsed, stored) };
    } catch (e) {
      if (!(e instanceof CliError) || e.exitCode !== 1) throw e;
      result.error = e.message;
    }
  }

  if (opts.json) await out(JSON.stringify(results, null, 2));
  else {
    for (const r of results) {
      console.log(reportLines(r.report).join("\n"));
      if (r.error) console.log(`  not applied: ${r.error}`);
      if (r.applied) {
        const bad = r.applied.stored_check;
        console.log(`  applied as import ${r.applied.import_id}, check 4 ${bad.length ? "FAIL" : "PASS"}`);
        for (const b of bad) console.log(`    ${b.line ? `line ${b.line} ` : ""}${b.message}`);
      }
      console.log("");
    }
    const passed = results.filter((r) => r.report.ok).length;
    console.log(`${passed} of ${results.length} files pass${opts.apply ? "" : ". Nothing was changed; run with --apply to import them."}`);
  }
  const ok = results.every((r) => r.report.ok && (!opts.apply || (r.applied && !r.applied.stored_check.length)));
  return ok ? 0 : 1;
}
