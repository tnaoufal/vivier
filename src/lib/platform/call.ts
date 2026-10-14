/**
 * Calling a server function from the browser: the access token goes
 * along (the server reads the caller from it and nothing else), and an
 * error code the server answers (errors.ts) becomes a sentence in the
 * person's language. Used by every feature; never call a gated server
 * function without it.
 */
import { freshAccessToken } from "@/lib/auth/session-token";
import type { Locale } from "@/lib/db/types";
import { translate, type TranslationKey } from "@/lib/i18n";

import { appErrorCode, type AppErrorCode } from "./errors";

const CODE_KEYS: Record<AppErrorCode, TranslationKey> = {
  "AUTH:required": "auth.signIn",
  "AUTH:not_configured": "auth.notConfigured",
  "ORG:forbidden": "common.forbidden",
  "ORG:not_member": "common.forbidden",
  "ORG:seats": "common.forbidden",
  "ORG:quota": "common.forbidden",
  "RATE:limited": "common.rateLimited",
  "SETUP:model": "common.notConfigured",
  "SETUP:email": "common.notConfigured",
  "SETUP:processor": "common.notConfigured",
  "SETUP:service_key": "common.notConfigured",
  "INPUT:invalid": "common.error",
  "INPUT:job_changed": "briefs.analysis.jobChanged",
  NOT_FOUND: "common.notFound",
};

/** The sentence for an error a server function threw, in the locale; a generic one when unknown. */
export function errorMessage(
  locale: Locale,
  error: unknown,
  overrides?: Partial<Record<AppErrorCode, string>>,
): string {
  const code = appErrorCode(error);
  if (code) {
    const override = overrides?.[code];
    if (override) return override;
    return translate(locale, CODE_KEYS[code]);
  }
  return translate(locale, "common.error");
}

/** Spreads into a server call's data: `{ ...(await withToken()), orgId }`. */
export async function withToken(): Promise<{ accessToken: string }> {
  const token = await freshAccessToken();
  if (!token) throw new Error("AUTH:required");
  return { accessToken: token };
}
