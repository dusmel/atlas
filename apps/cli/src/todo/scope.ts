/**
 * Which repo an `atlas todo` command is about: the current directory's store dir,
 * `--repo NAME`, `--personal`, or `--all`.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { reposDir } from "../config.ts";
import { bestGuessRoot, dirRepoInfo, resolveRepo } from "../git.ts";
import { findExistingPromotedDir } from "../repo.ts";
import { CliError } from "./client.ts";

/** `{id, name}` lets the server create or rename the repo; a bare name must already exist there. */
export type RepoRef = { id: string; name: string } | string;
export type Scope = RepoRef | "all";

export const PERSONAL = { id: "_personal", name: "personal" };

export function metaOf(dir: string): { id: string } | null {
  try {
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    return typeof meta.id === "string" ? meta : null;
  } catch {
    return null;
  }
}

export async function scopeOf(flags: Record<string, string | boolean>, cwd = process.cwd()): Promise<Scope> {
  const picked = ["all", "personal", "repo"].filter((f) => flags[f] !== undefined);
  if (picked.length > 1) throw new CliError(2, "Use only one of --repo, --all and --personal");
  if (flags.all) return "all";
  if (flags.personal) return PERSONAL;
  if (typeof flags.repo === "string") {
    const meta = metaOf(join(reposDir(), flags.repo));
    return meta ? { id: meta.id, name: flags.repo } : flags.repo;
  }
  const repo = (await resolveRepo(cwd)) ?? dirRepoInfo(await bestGuessRoot(cwd));
  const dir = await findExistingPromotedDir(repo);
  if (!dir) throw new CliError(2, "Not in a promoted repo. Use --repo NAME, --all or --personal");
  return { id: repo.id, name: basename(dir) };
}

/** The value for `?repo=` or a request body. */
export const repoParam = (ref: RepoRef) => (typeof ref === "string" ? ref : ref.id);
