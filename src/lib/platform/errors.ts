/**
 * The errors a server function may answer with. The message is a code the
 * browser turns into a sentence in the person's language (never free text
 * from the server); the status is for the HTTP answer.
 */
export type AppErrorCode =
  | "AUTH:required"
  | "AUTH:not_configured"
  | "ORG:forbidden"
  | "ORG:not_member"
  | "ORG:seats"
  | "ORG:quota"
  | "RATE:limited"
  | "SETUP:model"
  | "SETUP:email"
  | "SETUP:processor"
  | "SETUP:service_key"
  | "INPUT:invalid"
  | "NOT_FOUND";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode, status?: number) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? statusOf(code);
  }
}

function statusOf(code: AppErrorCode): number {
  if (code.startsWith("AUTH:")) return 401;
  if (code.startsWith("ORG:")) return 403;
  if (code.startsWith("RATE:")) return 429;
  if (code.startsWith("SETUP:")) return 503;
  if (code === "NOT_FOUND") return 404;
  return 400;
}

/** The code carried by an error thrown on the server, read on either side. */
export function appErrorCode(error: unknown): AppErrorCode | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = /^(AUTH|ORG|RATE|SETUP|INPUT):[a-z_]+|^NOT_FOUND/.exec(message);
  return match ? (match[0] as AppErrorCode) : null;
}
