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
export const GENERIC_AUTH_ERROR_FR = "Une erreur est survenue. Réessayez.";

/** The same sentences in French; a code missing here falls back to the generic sentence. */
const MESSAGES_FR: Record<string, string> = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  email_not_confirmed: "Confirmez d'abord votre adresse email : le lien est dans votre boîte de réception.",
  user_already_exists: "Un compte existe déjà pour cette adresse. Connectez-vous, ou utilisez Mot de passe oublié.",
  email_exists: "Un compte existe déjà pour cette adresse. Connectez-vous, ou utilisez Mot de passe oublié.",
  weak_password: "Choisissez un mot de passe plus robuste.",
  same_password: "Choisissez un mot de passe différent de l'actuel.",
  over_email_send_rate_limit: "Trop d'emails ont été envoyés à cette adresse. Patientez une minute et réessayez.",
  over_request_rate_limit: "Trop de tentatives. Patientez une minute et réessayez.",
  manual_linking_disabled: "La connexion et la déconnexion de méthodes de connexion ne sont pas encore activées.",
  identity_already_exists: "Cette méthode de connexion est déjà rattachée à un autre compte.",
  reauthentication_needed: "Reconnectez-vous pour faire cette modification.",
  session_not_found: "Votre session a expiré. Reconnectez-vous.",
  session_expired: "Votre session a expiré. Reconnectez-vous.",
  refresh_token_not_found: "Votre session a expiré. Reconnectez-vous.",
  validation_failed: "Vérifiez ce que vous avez saisi et réessayez.",
  signup_disabled: "Les nouveaux comptes ne sont pas acceptés pour le moment.",
  provider_disabled: "Cette méthode de connexion n'est pas encore activée.",
  email_address_invalid: "Saisissez une adresse email valide.",
  otp_expired: "Ce lien a expiré. Demandez-en un nouveau.",
  bad_jwt: "Votre session a expiré. Reconnectez-vous.",
};

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
export function friendlyAuthError(error: unknown, locale: "fr" | "en" = "en"): string {
  const code = codeOf(error);
  const message = messageOf(error);
  if (message || code) console.warn("[auth]", code ?? "", message);
  const table = locale === "fr" ? MESSAGES_FR : MESSAGES;
  if (code && table[code]) return table[code];
  if (NETWORK_TEXT.test(message)) {
    return locale === "fr"
      ? "Le service de connexion est injoignable. Vérifiez votre connexion et réessayez."
      : "Could not reach the sign-in service. Check your connection and try again.";
  }
  return locale === "fr" ? GENERIC_AUTH_ERROR_FR : GENERIC_AUTH_ERROR;
}
