import { RuleError } from "@atlas/todos"

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message }, ...extra }, { status })
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

// Rule violations are the client's fault, so they map to 400.
export async function handle(fn: () => unknown, status = 200): Promise<Response> {
  try {
    return Response.json(await fn(), { status })
  } catch (e) {
    if (e instanceof HttpError) return apiError(e.status, e.code, e.message, e.extra)
    if (e instanceof RuleError) return apiError(400, e.code, e.message)
    throw e
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_json", "Send a JSON object")
  return body as Record<string, unknown>
}
