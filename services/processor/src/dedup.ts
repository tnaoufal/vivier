/**
 * The same person across different files. Two PDF exports of one CV have
 * different bytes (the sha256 catches only identical files), so the
 * candidate a new reading belongs to is looked up by what identifies a
 * person, from the surest key to the least sure, and the first hit wins:
 *
 * 1. the candidate the document was pinned to (uploaded from a profile
 *    page: the person chose the target);
 * 2. the email, case-insensitively;
 * 3. the phone number by its last nine digits, so "+33 6 12 34 56 78" and
 *    "06.12.34.56.78" meet (nine digits are enough to tell numbers apart
 *    and survive a dropped or added country code);
 * 4. the fingerprint (email, else name + phone digits, else name + the
 *    latest company or first school; structure.ts).
 *
 * A name alone never merges: two people may share one. And a contact
 * detail alone does not merge two people whose names disagree: CVs sent
 * through an agency, a family mailbox or a company switchboard carry one
 * email or one number for several people, and a merge would give person
 * A's record person B's background, then present the wrong CV for a
 * brief. So an email, phone or fingerprint hit is refused when both names
 * are full (two words or more) and share not one word ("M. Dupont" and
 * "Marie Dupont" still meet; "Jean Martin" and "Marie Dupont" do not);
 * the refusal is logged and the next key is tried.
 *
 * Everything here is pure except the lookups, which go through the `Db`
 * interface so the tests run against the in-memory fake.
 */
import type { Db } from "./db.js";
import { logInfo } from "./log.js";
import { fingerprintOf, normaliseName, type Profile } from "./structure.js";
import type { CandidateRow, DocumentRow } from "./types.js";

/** The trailing digits two phone numbers must share to count as the same number. */
export const PHONE_MATCH_DIGITS = 9;

export type DedupKey = "pinned" | "email" | "phone" | "fingerprint";

export interface DedupMatch {
  candidate: CandidateRow;
  /** Which key found the candidate; logged so a wrong merge can be traced. */
  by: DedupKey;
}

/** The part of the database the deduplication reads. */
export type DedupDb = Pick<
  Db,
  | "getCandidateById"
  | "findCandidateByEmail"
  | "findCandidateByPhoneDigits"
  | "findCandidateByFingerprint"
>;

/** The email as a lookup key: trimmed and lowercased; null when empty. */
export function emailKeyOf(email: string | null | undefined): string | null {
  const key = email?.trim().toLowerCase() ?? "";
  return key ? key.slice(0, 254) : null;
}

/** The digits of a phone number, nothing else. */
export function phoneDigitsOf(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** The last PHONE_MATCH_DIGITS digits of a phone number; null when it holds fewer. */
export function phoneKeyOf(phone: string | null | undefined): string | null {
  const digits = phoneDigitsOf(phone);
  return digits.length >= PHONE_MATCH_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : null;
}

/** The words of a name, normalised (structure.ts); empty for no name. */
export function nameTokensOf(name: string | null | undefined): string[] {
  return normaliseName(name).split(" ").filter((token) => token.length > 0);
}

/**
 * True when the two names are both full (two words or more) and share no
 * word: two different people. A single word or an empty name says too
 * little to disagree, and an initial ("M.") is one word that another
 * full name's surname matches.
 */
export function namesDisagree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nameTokensOf(a);
  const right = nameTokensOf(b);
  if (left.length < 2 || right.length < 2) return false;
  return !left.some((token) => right.includes(token));
}

export async function findExistingCandidate(
  db: DedupDb,
  orgId: string,
  doc: Pick<DocumentRow, "candidate_id">,
  profile: Profile,
): Promise<DedupMatch | null> {
  if (doc.candidate_id) {
    const pinned = await db.getCandidateById(orgId, doc.candidate_id);
    if (pinned) return { candidate: pinned, by: "pinned" };
  }
  // A hit on a shared contact detail is refused when the names say two
  // people; the fingerprint path gets the same guard because the
  // fingerprint of a candidate with an email is that email.
  const accept = (candidate: CandidateRow | null, by: DedupKey): DedupMatch | null => {
    if (!candidate) return null;
    if (namesDisagree(candidate.full_name, profile.full_name)) {
      logInfo("dedup_name_conflict", { orgId, candidateId: candidate.id, by });
      return null;
    }
    return { candidate, by };
  };
  const email = emailKeyOf(profile.email);
  if (email) {
    const byEmail = accept(await db.findCandidateByEmail(orgId, email), "email");
    if (byEmail) return byEmail;
  }
  const phone = phoneKeyOf(profile.phone);
  if (phone) {
    const byPhone = accept(await db.findCandidateByPhoneDigits(orgId, phone), "phone");
    if (byPhone) return byPhone;
  }
  // When the fingerprint is the email, the email lookup already covered it
  // (a candidate's fingerprint is its email whenever it has one).
  const fingerprint = fingerprintOf(profile);
  if (fingerprint && fingerprint !== email) {
    const byFingerprint = accept(await db.findCandidateByFingerprint(orgId, fingerprint), "fingerprint");
    if (byFingerprint) return byFingerprint;
  }
  return null;
}
