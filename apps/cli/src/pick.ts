/**
 * `atlas __pick-doc [query]`: the fuzzy doc finder zsh opens on Tab after `atlas doc md` or `publish`.
 * It draws on the terminal through fd 2, so the chosen path is all that reaches stdout. zsh passes the size
 * in COLUMNS and LINES: Bun cannot make process.stderr when stdout is a pipe and stderr a terminal.
 */

import { existsSync, readdirSync, realpathSync, statSync, writeSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { isatty } from "node:tty";
import { Glob } from "bun";
import { reposDir } from "./config.ts";
import { bestGuessRoot, dirRepoInfo, resolveRepo } from "./git.ts";
import { findExistingPromotedDir } from "./repo.ts";

export type Doc = { repo: string; path: string; mtime: number; current: boolean };
type Here = { repo: string; base: string } | null;

/** The repo the shell is in, and the folder its docs are reached through from here. */
async function here(cwd: string, root: string): Promise<Here> {
  const real = realpathSync(cwd);
  const store = realpathSync(root);
  if (real.startsWith(store + sep)) {
    const repo = relative(store, real).split(sep)[0]!;
    return { repo, base: join(root, repo) };
  }
  const info = (await resolveRepo(cwd)) ?? dirRepoInfo(await bestGuessRoot(cwd));
  const dir = await findExistingPromotedDir(info);
  if (!dir) return null;
  const link = join(info.repoRoot, "atlas");
  return { repo: basename(dir), base: existsSync(link) ? link : dir };
}

export function listDocs(root: string, current: string | null): Doc[] {
  const docs: Doc[] = [];
  const glob = new Glob("**/*.{md,html}");
  for (const repo of readdirSync(root, { withFileTypes: true })) {
    if (!repo.isDirectory() || repo.name.startsWith(".")) continue;
    for (const path of glob.scanSync({ cwd: join(root, repo.name) })) {
      if (path.split("/").includes("backups")) continue;
      docs.push({ repo: repo.name, path, mtime: statSync(join(root, repo.name, path)).mtimeMs, current: repo.name === current });
    }
  }
  return docs;
}

const BOUNDARY = new Set(["/", "-", "_", ".", " "]);

/** fzf-style: each letter of `term` in order, scored up for word starts and runs, down for gaps. */
export function fuzzy(term: string, text: string): { score: number; at: number[] } | null {
  const t = text.toLowerCase();
  const at: number[] = [];
  let from = 0;
  for (const ch of term.toLowerCase()) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    at.push(i);
    from = i + 1;
  }
  // Walk back from the last letter to the latest start, which keeps the match tight.
  for (let k = at.length - 2; k >= 0; k--) {
    const i = t.lastIndexOf(t[at[k]!]!, at[k + 1]! - 1);
    if (i > at[k]!) at[k] = i;
  }
  let score = 0;
  for (let k = 0; k < at.length; k++) {
    const i = at[k]!;
    score += 16;
    if (i === 0 || BOUNDARY.has(t[i - 1]!)) score += 8;
    if (k > 0 && at[k - 1] === i - 1) score += 6;
    else if (k > 0) score -= Math.min(i - at[k - 1]! - 1, 6);
  }
  if (at[0]! > text.lastIndexOf("/")) score += 10;
  return { score, at };
}

export type Hit = { doc: Doc; label: string; at: number[]; score: number };

const labelOf = (d: Doc) => (d.current ? d.path : `${d.repo}/${d.path}`);

// Wins a tie for the current repo, but loses to a clearly better match elsewhere (measured on "herdr cheat").
const HERE_BONUS = 40;

/** Every space-separated term must match. With no query, the current repo's docs come first, newest first. */
export function rank(docs: Doc[], query: string): Hit[] {
  const terms = query.split(/\s+/).filter(Boolean);
  const hits: Hit[] = [];
  for (const doc of docs) {
    const label = labelOf(doc);
    let score = 0;
    const at: number[] = [];
    let ok = true;
    for (const term of terms) {
      const m = fuzzy(term, label);
      if (!m) {
        ok = false;
        break;
      }
      score += m.score;
      at.push(...m.at);
    }
    if (ok) hits.push({ doc, label, at, score: score + (doc.current ? HERE_BONUS : 0) });
  }
  return hits.sort((a, b) => (terms.length ? 0 : Number(b.doc.current) - Number(a.doc.current)) || b.score - a.score || b.doc.mtime - a.doc.mtime);
}

/** What goes on the command line: a path from here for the current repo, else the doc's place in the store. */
const pathOf = (d: Doc, place: Here, root: string, cwd: string) =>
  d.current && place ? relative(cwd, join(place.base, d.path)) : join(root, d.repo, d.path);

const ESC = "\x1b[";
const cols = () => Number(process.env.COLUMNS) || 80;
const rows = () => Number(process.env.LINES) || 24;
const tty = (s: string) => void writeSync(2, s);

function draw(query: string, hits: Hit[], total: number, sel: number, top: number, current: string | null) {
  const room = Math.max(rows() - 2, 1);
  const lines = [`${ESC}1m›${ESC}0m ${query}`, `${ESC}2m  ${hits.length}/${total}${current ? `  ·  ${current} first` : ""}${ESC}0m`];
  for (let n = top; n < Math.min(hits.length, top + room); n++) {
    const { label, at, doc } = hits[n]!;
    const marks = new Set(at);
    const repoEnd = doc.current ? 0 : doc.repo.length + 1;
    let text = "";
    for (let i = 0; i < Math.min(label.length, cols() - 3); i++) {
      const ch = label[i]!;
      text += marks.has(i) ? `${ESC}1;33m${ch}${ESC}22;39m` : i < repoEnd ? `${ESC}2m${ch}${ESC}22m` : ch;
    }
    lines.push(n === sel ? `${ESC}7m▌${ESC}27m ${ESC}1m${text}${ESC}0m` : `  ${text}`);
  }
  tty(`${ESC}H${ESC}2J${lines.join("\r\n")}${ESC}1;${query.length + 3}H`);
}

/** Exit 0 with the path printed, 1 when cancelled, 2 when there is no terminal to draw on. */
export async function cmdPickDoc(args: string[]): Promise<number> {
  if (!isatty(0) || !isatty(2)) return 2;
  const cwd = process.cwd();
  const root = reposDir();
  const place = await here(cwd, root).catch(() => null);
  const docs = listDocs(root, place?.repo ?? null);
  let query = args.join(" ");
  let sel = 0;
  let top = 0;
  let hits = rank(docs, query);
  const render = () => {
    const room = Math.max(rows() - 2, 1);
    sel = Math.max(0, Math.min(sel, hits.length - 1));
    if (sel < top) top = sel;
    if (sel >= top + room) top = sel - room + 1;
    draw(query, hits, docs.length, sel, top, place?.repo ?? null);
  };

  tty(`${ESC}?1049h`);
  process.stdin.setRawMode(true);
  render();
  const picked = await new Promise<Hit | null>((done) => {
    process.stdin.on("data", (buf: Buffer) => {
      const key = buf.toString();
      if (key === "\r") return done(hits[sel] ?? null);
      if (key === "\x1b" || key === "\x03" || key === "\x07") return done(null);
      if (key === `${ESC}A` || key === "\x1bOA" || key === "\x10" || key === `${ESC}Z`) sel--;
      else if (key === `${ESC}B` || key === "\x1bOB" || key === "\x0e" || key === "\t" || key === "\n") sel++;
      else if (key === `${ESC}5~`) sel -= rows() - 2;
      else if (key === `${ESC}6~`) sel += rows() - 2;
      else {
        if (key === "\x7f" || key === "\b") query = query.slice(0, -1);
        else if (key === "\x15") query = "";
        else if (key === "\x17") query = query.replace(/\S*\s*$/, "");
        else if (key.startsWith("\x1b")) return;
        else query += key.replace(/[\x00-\x1f]/g, "");
        hits = rank(docs, query);
        sel = 0;
      }
      render();
    });
  });
  process.stdin.setRawMode(false);
  process.stdin.pause();
  tty(`${ESC}?1049l`);
  if (!picked) return 1;
  process.stdout.write(pathOf(picked.doc, place, root, cwd));
  return 0;
}
