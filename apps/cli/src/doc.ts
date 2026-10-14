/**
 * `atlas doc`: send one doc to the server now, or print a doc's markdown (spec section 7).
 */

import { realpathSync, statSync } from "node:fs";
import { isatty } from "node:tty";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { frontmatter } from "@atlas/doc-render";
import { htmlText } from "@atlas/indexer";
import { reposDir } from "./config.ts";
import { parseArgs, type FlagSpec } from "./todo/args.ts";
import { api, CliError, loadConfig } from "./todo/client.ts";
import { err, out, page } from "./util.ts";

export const DOC_USAGE = `atlas doc — one doc on the Atlas server.

Usage:
  atlas doc publish <file> [--json]   send the doc now and print its link; MEGA's copy takes over once it arrives
  atlas doc md <file> [--plain]       print the doc's markdown: an md file as written, or an html doc's atlas-md block

At a terminal, md renders the markdown in colour, through $PAGER when it is long; --plain, or a pipe, prints it as written.

The file is a doc in a repo's atlas/ folder. publish does not make it public: Make public on its page does that.`;

/** Where a local doc lives on the server: its repo's folder under the atlas repos dir, and its path inside it. */
export function docPlace(file: string, repos = reposDir()): { repo: string; path: string } {
  let real: string;
  try {
    real = realpathSync(resolve(file));
  } catch {
    throw new CliError(2, `No file ${file}`);
  }
  // A repo's atlas/ is a link into the repos dir, so the real path names the repo.
  const rel = relative(realpathSync(repos), real);
  const [repo, ...rest] = rel.split(sep);
  if (!repo || repo === ".." || isAbsolute(rel) || !rest.length) throw new CliError(2, `${file} is not in a repo's atlas/ folder (${repos})`);
  if (!/\.(md|html)$/.test(real)) throw new CliError(2, `${file} is not a doc: only md and html files publish`);
  return { repo, path: rest.join("/") };
}

/** An md file as written, or an html doc's markdown block; null when an html doc has none. */
export const markdownOf = (file: string, text: string): string | null => (file.endsWith(".md") ? text : htmlText(text, file).contract.md);

export const DOC_COMMANDS: Record<string, { about: string; flags: FlagSpec }> = {
  publish: { about: "Send the doc to the server now", flags: { json: "boolean" } },
  md: { about: "Print the doc's markdown", flags: { plain: "boolean" } },
};

/** Markdown for a person at a terminal: Bun's own renderer, so no dependency. It knows no frontmatter, so that is left out. */
export const renderMd = (md: string, width: number, color: boolean): string =>
  Bun.markdown.ansi(frontmatter(md).body, { columns: width, colors: color, hyperlinks: color }).replace(/\n+$/, "");

export async function cmdDoc(args: string[]): Promise<void> {
  try {
    const [sub, ...words] = args;
    if (!sub || sub === "--help" || sub === "-h") return console.log(DOC_USAGE);
    if (!(sub in DOC_COMMANDS)) throw new CliError(2, `Unknown command: doc ${sub}\n\n${DOC_USAGE}`);
    const { flags, rest } = parseArgs(words, { ...DOC_COMMANDS[sub]!.flags, help: "boolean" });
    if (flags.help) return console.log(DOC_USAGE);
    if (rest.length !== 1) throw new CliError(2, DOC_USAGE);
    const file = rest[0]!;
    const text = await Bun.file(file)
      .text()
      .catch(() => {
        throw new CliError(2, `No file ${file}`);
      });
    if (sub === "md") {
      const md = markdownOf(file, text);
      if (md === null) throw new CliError(1, `${file} has no markdown block: <script type="text/markdown" id="atlas-md">`);
      // Rendered only for a person: a pipe or --plain gets the markdown as written, which is how agents read it.
      if (flags.plain || !isatty(1)) return out(md.replace(/\n$/, ""));
      return page(renderMd(md, Math.min(process.stdout.columns || 100, 120), !process.env.NO_COLOR));
    }
    const { repo, path } = docPlace(file);
    const cfg = loadConfig();
    const res = await api<{ href: string; fast: boolean }>(cfg, "POST", "/docs/publish", { repo, path, mtime: statSync(file).mtimeMs, text });
    if (flags.json) return out(JSON.stringify(res));
    await out(`${cfg.url}${res.href}`);
    if (!res.fast) err("The server already had this version or a newer one.");
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    err(e.message);
    process.exitCode = e.exitCode;
  }
}
