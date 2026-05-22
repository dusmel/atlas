/**
 * Environment-derived configuration for Atlas paths and thresholds.
 *
 * All values are computed at import time from environment variables or
 * fallbacks so that downstream modules can import them synchronously.
 */

const ATLAS_ROOT: string = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;

/** Directory where promoted repo metadata lives. */
export const REPOS_DIR: string = `${ATLAS_ROOT}/repos`;

/** Directory where candidate scoring state files are stored. */
export const STATE_DIR: string = `${ATLAS_ROOT}/state/candidates`;

/** Score threshold above which a candidate is auto-promoted. */
export const THRESHOLD: number = Number(process.env.ATLAS_THRESHOLD ?? "4");

/** Seconds of inactivity after which a candidate score resets. */
export const STALE_SECONDS: number = 48 * 60 * 60;
