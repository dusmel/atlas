/**
 * Environment-derived configuration for Atlas paths and thresholds.
 *
 * All values are read dynamically from environment variables so that tests
 * can override them at runtime without module re-imports.
 */

/** Base atlas storage directory (override with ATLAS_ROOT env var). */
export function atlasRoot(): string {
  return process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
}

/** Directory where promoted repo metadata lives. */
export function reposDir(): string {
  return `${atlasRoot()}/repos`;
}

/** Directory where candidate scoring state files are stored. */
export function stateDir(): string {
  return `${atlasRoot()}/state/candidates`;
}

/** Score threshold above which a candidate is auto-promoted. */
export function threshold(): number {
  return Number(process.env.ATLAS_THRESHOLD ?? "4");
}

/** Seconds of inactivity after which a candidate score resets. */
export function staleSeconds(): number {
  return 48 * 60 * 60;
}

// Backward-compatible constant exports (read once at import time)
export const REPOS_DIR = reposDir();
export const STATE_DIR = stateDir();
export const THRESHOLD = threshold();
export const STALE_SECONDS = staleSeconds();

/** Maps common aliases back to their canonical command forms. */
export const ALIASES: Record<string, string> = {
  gst: "git status",
  gd: "git diff",
  ga: "git add",
  gaa: "git add --all",
  ggpush: "git push origin '$(git_current_branch)'",
  ggpull: "git pull origin '$(git_current_branch)'",
  gsb: "git switch -c",
  gcom: "git commit --amend --no-edit",
  c: "code",
  vi: "nvim",
  v: "nvim",
};

/** Ordered list of token-prefix → score rules. First match wins. */
export const SCORE_RULES: Array<{ tokens: string[]; score: number }> = [
  { tokens: ["git", "help"], score: 0 },
  { tokens: ["git", "version"], score: 0 },
  { tokens: ["git", "rev-parse"], score: 0 },
  { tokens: ["git", "status"], score: 1 },
  { tokens: ["git", "log"], score: 1 },
  { tokens: ["git", "branch"], score: 1 },
  { tokens: ["git", "show"], score: 1 },
  { tokens: ["git", "remote", "-v"], score: 1 },
  { tokens: ["git", "diff"], score: 2 },
  { tokens: ["git", "switch"], score: 2 },
  { tokens: ["git", "checkout"], score: 2 },
  { tokens: ["git", "pull"], score: 2 },
  { tokens: ["git", "fetch"], score: 2 },
  { tokens: ["git", "add"], score: 4 },
  { tokens: ["git", "commit"], score: 4 },
  { tokens: ["git", "merge"], score: 4 },
  { tokens: ["git", "rebase"], score: 4 },
  { tokens: ["git", "stash"], score: 4 },
  { tokens: ["git", "cherry-pick"], score: 4 },
  { tokens: ["git", "worktree", "add"], score: 4 },
  { tokens: ["zed"], score: 1 },
  { tokens: ["code"], score: 1 },
  { tokens: ["vim"], score: 1 },
  { tokens: ["nvim"], score: 1 },
  { tokens: ["opencode"], score: 1 },
  { tokens: ["pi"], score: 1 },
  { tokens: ["claude"], score: 1 },
  { tokens: ["claude-code"], score: 1 },
];
