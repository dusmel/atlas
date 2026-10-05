// Browser calls to the Atlas API. Cookie-authenticated changes must carry X-Atlas (spec section 8).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-atlas": "1", ...init.headers },
  })
  if (res.status === 401) {
    window.location.href = "/login"
    throw new ApiError(401, "unauthorized", "Your session ended. Log in again.", null)
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, error?.code ?? "error", error?.message ?? `The server answered ${res.status}.`, body)
  }
  return body as T
}

export const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })
