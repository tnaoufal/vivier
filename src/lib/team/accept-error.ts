/**
 * What accept_invitation() can refuse, as the dictionary key of the
 * sentence to show. The database raises 'INVITE:<reason>' and PostgREST
 * passes it as the error message; anything else is the generic sentence.
 */

export type AcceptErrorKey =
  | "invite.notFound"
  | "invite.used"
  | "invite.expired"
  | "invite.emailMismatch"
  | "invite.error";

export function acceptErrorKey(message: string | null | undefined): AcceptErrorKey {
  const text = message ?? "";
  if (text.includes("INVITE:not_found")) return "invite.notFound";
  if (text.includes("INVITE:used")) return "invite.used";
  if (text.includes("INVITE:expired")) return "invite.expired";
  if (text.includes("INVITE:email_mismatch")) return "invite.emailMismatch";
  return "invite.error";
}
