// Domain rules from spec section 5. Pure checks: callers look up rows, these decide.

export const STATUSES = ["todo", "doing", "done"] as const
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const
export type Status = (typeof STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]

export class RuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function parseTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : ""
  if (title.length < 1 || title.length > 500) throw new RuleError("bad_title", "Title must be 1 to 500 characters")
  return title
}

export function parseStatus(value: unknown): Status {
  if (STATUSES.includes(value as Status)) return value as Status
  throw new RuleError("bad_status", `Status must be one of ${STATUSES.join(", ")}`)
}

// null and "inbox" both mean Inbox.
export function parsePriority(value: unknown): Priority | null {
  if (value === null || value === "inbox") return null
  if (PRIORITIES.includes(value as Priority)) return value as Priority
  throw new RuleError("bad_priority", "Priority must be P0, P1, P2, P3 or inbox")
}

type ParentRow = { id: number; repo_id: string; parent_id: number | null }

// One level of parent, in the same repo.
export function checkParent(item: { id?: number; repo_id: string; has_children: boolean }, parent: ParentRow): void {
  if (item.id === parent.id) throw new RuleError("bad_parent", "An item cannot be its own parent")
  if (parent.repo_id !== item.repo_id) throw new RuleError("bad_parent", `#${parent.id} is in another repo`)
  if (parent.parent_id !== null) throw new RuleError("bad_parent", `#${parent.id} is already a child of #${parent.parent_id}`)
  if (item.has_children) throw new RuleError("bad_parent", `#${item.id} has children, so it cannot have a parent`)
}

export function checkGroup(item: { repo_id: string }, group: { id: number; repo_id: string }): void {
  if (group.repo_id !== item.repo_id) throw new RuleError("bad_group", `Group ${group.id} belongs to another repo`)
}

export function doneAt(from: Status, to: Status, current: string | null, now: string): string | null {
  if (to !== "done") return null
  return from === "done" ? current : now
}
