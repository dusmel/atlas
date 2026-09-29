/**
 * One-off maintenance script: reconcile promoted directory names with the
 * current naming rules (local basename + stable `id`).
 *
 * NOT part of the `atlas` CLI surface — run explicitly when naming rules
 * evolve or old remote-based directory names need migrating:
 *
 *   bun apps/cli/scripts/migrate-promoted-dirs.ts            # dry run (default)
 *   bun apps/cli/scripts/migrate-promoted-dirs.ts --apply    # apply renames
 *   bun apps/cli/scripts/migrate-promoted-dirs.ts --apply --repo PATH  # single repo
 *
 * Rules:
 * - `ideal` = current local basename, `suggested` = ideal + 4-char hash.
 * - Rename only when the current dir matches the old remote-based name or
 *   the repo identity (`id`) changed. User custom names are left alone.
 * - Never deletes: missing roots are reported as `stale`, ambiguous cases
 *   as `conflict`. `meta.json` (`repoId`) and the `repoRoot/atlas` symlink
 *   are repaired on `--apply`.
 */

import { join, basename } from "node:path";
import { access, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink } from "node:fs/promises";
import { reposDir } from "../src/config.ts";
import { resolveRepo, dirRepoInfo } from "../src/git.ts";
import { checkCollision, suggestUniqueName } from "../src/repo.ts";
import { atomicWrite, normalizeRemote, nowIso } from "../src/util.ts";

export type MigrateStatus = "ok" | "renamed" | "stale" | "conflict" | "error";
export type MigrateEntry = {
  current: string;
  target: string;
  status: MigrateStatus;
  detail?: string;
};

type Promoted = { name: string; dir: string; meta: Record<string, string> };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listPromoted(): Promise<Promoted[]> {
  let names: string[];
  try {
    names = await readdir(reposDir());
  } catch {
    return [];
  }
  const out: Promoted[] = [];
  for (const name of names) {
    const dir = join(reposDir(), name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
      if (!meta?.id || !meta?.repoRoot) continue;
      out.push({ name, dir, meta });
    } catch {
      // unreadable or missing meta.json — skip
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function pickTarget(ideal: string, suggested: string, id: string): Promise<string | null> {
  if (!(await exists(join(reposDir(), ideal)))) return ideal;
  // Ideal exists: usable only if it belongs to someone else AND suggested is free.
  // Same-id duplicates are reported as conflicts (never merged automatically).
  if (!(await checkCollision(ideal, id))) return null;
  if (!(await exists(join(reposDir(), suggested)))) return suggested;
  if (!(await checkCollision(suggested, id))) return null;
  return null;
}

export async function planMigrate(repoFilter?: string): Promise<MigrateEntry[]> {
  const entries = await listPromoted();
  const out: MigrateEntry[] = [];

  for (const { name: current, meta } of entries) {
    const repoRoot = String(meta.repoRoot);
    if (repoFilter && repoRoot !== repoFilter) continue;
    if (!repoRoot) {
      out.push({ current, target: current, status: "error", detail: "meta.json has no repoRoot" });
      continue;
    }
    if (!(await exists(repoRoot))) {
      out.push({ current, target: current, status: "stale", detail: `missing root ${repoRoot}` });
      continue;
    }

    const fresh = (await resolveRepo(repoRoot)) ?? dirRepoInfo(repoRoot);
    const ideal = fresh.repoId;
    const suggested = suggestUniqueName(ideal, fresh.id);
    const oldRemote = meta.remoteUrl ? normalizeRemote(String(meta.remoteUrl)) : null;

    if (current === ideal || current === suggested) {
      // Properly disambiguated name whose collision is gone collapses back
      // to the ideal — but only when the ideal is fully free. A taken ideal
      // (even by the same id) means keep the current name.
      if (current === suggested && current !== ideal && !(await exists(join(reposDir(), ideal)))) {
        out.push({ current, target: ideal, status: "renamed", detail: "collision gone" });
        continue;
      }
      out.push({ current, target: current, status: "ok" });
      continue;
    }

    const identityChanged = fresh.id !== meta.id;
    const isOldRemoteName = !!oldRemote && current === oldRemote;
    if (!isOldRemoteName && !identityChanged) {
      out.push({ current, target: current, status: "ok", detail: "custom name, kept" });
      continue;
    }

    const target = await pickTarget(ideal, suggested, fresh.id);
    if (!target) {
      out.push({ current, target: current, status: "conflict", detail: `ideal "${ideal}" taken` });
      continue;
    }
    out.push({
      current,
      target,
      status: "renamed",
      detail: isOldRemoteName ? "old remote-based name" : "identity changed",
    });
  }

  // Flag duplicate roots without changing behavior.
  const byRoot = new Map<string, string[]>();
  for (const e of entries) {
    const root = String(e.meta.repoRoot);
    byRoot.set(root, [...(byRoot.get(root) ?? []), e.name]);
  }
  for (const [root, names] of byRoot) {
    if (names.length < 2) continue;
    for (const e of out) {
      if (names.includes(e.current) && e.status === "ok" && !e.detail) {
        e.detail = `duplicate root with ${names.filter((n) => n !== e.current).join(", ")} (${root})`;
      }
    }
  }

  return out;
}

async function fixMetaAndLink(
  dir: string,
  targetDir: string,
  meta: Record<string, string>,
  finalName: string,
): Promise<string | undefined> {
  const notes: string[] = [];
  if (meta.repoId !== finalName) {
    await mkdir(targetDir, { recursive: true });
    await atomicWrite(
      join(targetDir, "meta.json"),
      JSON.stringify({ ...meta, repoId: finalName, updatedAt: nowIso() }, null, 2) + "\n",
    );
    notes.push("meta fixed");
  }
  const repoRoot = String(meta.repoRoot);
  const linkPath = join(repoRoot, "atlas");
  try {
    if ((await readlink(linkPath)) === targetDir) return notes.join(", ") || undefined;
    await rm(linkPath);
    await symlink(targetDir, linkPath);
    notes.push("link fixed");
  } catch {
    try {
      const st = await stat(linkPath);
      if (st.isDirectory()) return [...notes, "real atlas/ dir left alone"].join(", ");
      await rm(linkPath);
      await symlink(targetDir, linkPath);
      notes.push("link fixed");
    } catch {
      // Path does not exist at all — create the symlink.
      try {
        await symlink(targetDir, linkPath);
        notes.push("link fixed");
      } catch {
        // best effort only
      }
    }
  }
  return notes.join(", ") || undefined;
}

export async function runMigrate(opts: { apply: boolean; repoFilter?: string }): Promise<MigrateEntry[]> {
  const plan = await planMigrate(opts.repoFilter);
  if (!opts.apply) return plan;

  const byCurrent = new Map((await listPromoted()).map((p) => [p.name, p]));
  for (const entry of plan) {
    const found = byCurrent.get(entry.current);
    if (!found) {
      entry.status = "error";
      entry.detail = "disappeared during migrate";
      continue;
    }
    if (entry.status === "stale" || entry.status === "conflict" || entry.status === "error") continue;

    if (entry.status === "renamed") {
      const from = join(reposDir(), entry.current);
      const to = join(reposDir(), entry.target);
      // The plan is computed before any rename, so two entries can target
      // the same ideal. First one wins; the other becomes a conflict.
      if (await exists(to)) {
        entry.status = "conflict";
        entry.detail = `"${entry.target}" taken during apply`;
        continue;
      }
      try {
        await rename(from, to);
      } catch (e) {
        entry.status = "error";
        entry.detail = `rename failed: ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      byCurrent.delete(entry.current);
      byCurrent.set(entry.target, { name: entry.target, dir: to, meta: found.meta });
      const extra = await fixMetaAndLink(from, to, found.meta, entry.target);
      if (extra) entry.detail = [entry.detail, extra].filter(Boolean).join("; ");
    } else {
      const dir = join(reposDir(), entry.current);
      const extra = await fixMetaAndLink(dir, dir, found.meta, entry.current);
      if (extra) entry.detail = [entry.detail, extra].filter(Boolean).join("; ");
    }
  }
  return plan;
}

function printPlan(plan: MigrateEntry[], dryRun: boolean): void {
  for (const e of plan) {
    const suffix = e.detail ? ` (${e.detail})` : "";
    if (e.status === "renamed") console.log(`${dryRun ? "would rename" : "renamed"} ${e.current} -> ${e.target}${suffix}`);
    else console.log(`${e.status} ${e.current}${suffix}`);
  }
  const counts = plan.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  console.log(
    `done: ${plan.length} entries ` +
      `(renamed=${counts.renamed ?? 0}, ok=${counts.ok ?? 0}, stale=${counts.stale ?? 0}, conflict=${counts.conflict ?? 0}, error=${counts.error ?? 0})${dryRun ? " [dry run]" : ""}`,
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const repoIdx = args.indexOf("--repo");
  const repoFilter = repoIdx === -1 ? undefined : args[repoIdx + 1];
  if (repoIdx !== -1 && !repoFilter) {
    console.error("Missing value for --repo");
    process.exitCode = 1;
  } else {
    printPlan(await runMigrate({ apply, repoFilter }), !apply);
  }
}
