/**
 * What the person reads when Supabase Auth or PostgREST refuses something.
 * The SDK's own text ("Invalid login credentials", "AuthApiError: ...") is
 * kept for the console; the toast gets one plain sentence keyed on the
 * error code, or a generic one when the code is unknown.
 */

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Wrong email or password.",
  email_not_confirmed: "Confirm your email address first: check your inbox for the link.",
  user_already_exists:
    "An account already exists for this address. Sign in, or use Forgot password.",
  email_exists: "An account already exists for this address. Sign in, or use Forgot password.",
  weak_password: "Choose a stronger password.",
  same_password: "Choose a password different from the current one.",
  over_email_send_rate_limit:
    "Too many emails were sent to this address. Wait a minute and try again.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  manual_linking_disabled: "Connecting and disconnecting sign-in methods is not enabled yet.",
  identity_already_exists: "That sign-in method is already attached to another account.",
  reauthentication_needed: "Sign in again to make this change.",
  session_not_found: "Your session ended. Sign in again.",
  session_expired: "Your session ended. Sign in again.",
  refresh_token_not_found: "Your session ended. Sign in again.",
  validation_failed: "Check what you typed and try again.",
  signup_disabled: "New accounts are not accepted right now.",
  provider_disabled: "This sign-in method is not enabled yet.",
  email_address_invalid: "Enter a valid email address.",
  otp_expired: "This link has expired. Ask for a new one.",
  bad_jwt: "Your session ended. Sign in again.",
};

const NETWORK_TEXT =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export const GENERIC_AUTH_ERROR = "Something went wrong. Try again.";

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : null;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * A plain sentence for a Supabase Auth or PostgREST error (or a thrown
 * fetch failure). The original is logged with `console.warn` so support can
 * still see what the service said.
 */
export function friendlyAuthError(error: unknown): string {
  const code = codeOf(error);
  const message = messageOf(error);
  if (message || code) console.warn("[auth]", code ?? "", message);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (NETWORK_TEXT.test(message)) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  return GENERIC_AUTH_ERROR;
}
