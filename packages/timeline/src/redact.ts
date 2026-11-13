// Drops every line that looks like it holds a secret, before text reaches the digest model and again
// before a digest is stored. Whole lines go, not just the match, since a key often spans a wrapped line.

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // Anthropic, OpenAI
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, // credentials in a URL
  // KEY=value, "token": "value", password: value. The value must be long enough to be a secret.
  /\b[\w-]*(?:token|secret|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth)[\w-]*["']?\s*[:=]\s*["']?(?!\$|\{\{|op:\/\/)[^\s"']{8,}/i,
  /\$2[aby]\$\d\d\$[./A-Za-z0-9]{40,}/, // bcrypt hash
]

// A long run of mixed case and digits with no spaces reads as a random key. Hex hashes and paths do not match:
// hashes have no capitals, and `/` breaks a path into short runs.
const RANDOM = /[A-Za-z0-9+_=-]{32,}/g
function looksRandom(line: string): boolean {
  for (const m of line.match(RANDOM) ?? []) {
    if (/[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m)) return true
  }
  return false
}

export function isSecretLine(line: string): boolean {
  return PATTERNS.some((p) => p.test(line)) || looksRandom(line)
}

/** The text with every secret-looking line removed, and how many lines went. */
export function redact(text: string): { text: string; dropped: number } {
  let dropped = 0
  const kept = text.split("\n").filter((l) => {
    const bad = isSecretLine(l)
    if (bad) dropped++
    return !bad
  })
  return { text: kept.join("\n"), dropped }
}
