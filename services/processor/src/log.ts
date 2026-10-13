/**
 * One JSON line per event, prefixed "[processor]" so Railway's log search
 * finds them: `{ event, ts, ...fields }`. An error is reduced to its name,
 * message, code and (one level of) cause: enough to diagnose, never a
 * secret. Document rows get a sentence (messages.ts); the log gets the
 * cause.
 */

export type LogFields = Record<string, unknown>;

export interface ErrorSummary {
  name: string;
  message: string;
  code?: string;
  status?: number;
  cause?: ErrorSummary;
}

export function describeError(error: unknown, depth = 0): ErrorSummary {
  if (error instanceof Error) {
    const summary: ErrorSummary = { name: error.name, message: error.message.slice(0, 600) };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") summary.code = code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") summary.status = status;
    if (depth < 2 && error.cause !== undefined && error.cause !== null) {
      summary.cause = describeError(error.cause, depth + 1);
    }
    return summary;
  }
  return { name: "Error", message: String(error).slice(0, 600) };
}

function line(event: string, fields: LogFields): string {
  const ts = new Date().toISOString();
  try {
    return JSON.stringify({ event, ts, ...fields });
  } catch {
    return JSON.stringify({ event, ts, note: "fields not serialisable" });
  }
}

export function logInfo(event: string, fields: LogFields = {}): void {
  console.info("[processor]", line(event, fields));
}

export function logWarn(event: string, fields: LogFields = {}): void {
  console.warn("[processor]", line(event, fields));
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  console.error("[processor]", line(event, { ...fields, error: describeError(error) }));
}
