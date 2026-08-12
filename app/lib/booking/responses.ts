export function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ ok: false, message, details }, { status });
}

export function logServerError(scope: string, error: unknown, context?: object) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      message,
      context,
    }),
  );
}
