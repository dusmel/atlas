/**
 * Shared domain types used across the Atlas CLI.
 */

/** A repository being observed for promotion. */
export type Candidate = {
  repoId: string;
  repoRoot: string;
  score: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/** Static metadata about a discovered git repository. */
export type RepoInfo = {
  repoRoot: string;
  repoId: string;
  id: string;
  remoteUrl: string;
};

/** Result of running a spawned child process. */
export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** Result of ensuring a repo is atlas-ready. */
export type EnsureResult = {
  repo: RepoInfo;
  changed: boolean;
};
