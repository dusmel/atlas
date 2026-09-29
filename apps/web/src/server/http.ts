export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}
