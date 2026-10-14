import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PHONE_MATCH_DIGITS,
  emailKeyOf,
  findExistingCandidate,
  nameTokensOf,
  namesDisagree,
  phoneDigitsOf,
  phoneKeyOf,
  type DedupDb,
} from "../src/dedup.js";
import { emptyProfile, type Profile } from "../src/structure.js";
import type { CandidateRow } from "../src/types.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const NOW = "2026-10-13T10:00:00.000Z";

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  const phone = overrides.phone ?? null;
  const digits = phone ? phone.replace(/\D/g, "") : "";
  return {
    id: "44444444-4444-4444-8444-000000000001",
    org_id: ORG,
    full_name: "Marie Dupont",
    email: null,
    phone,
    headline: null,
    location: null,
    years_experience: null,
    availability: null,
    summary: null,
    skills: [],
    languages: [],
    experiences: [],
    education: [],
    links: [],
    tags: [],
    confidence: {},
    source: "upload",
    consent_status: "unknown",
    consent_at: null,
    last_contact_at: null,
    status: "active",
    fingerprint: null,
    search_text: null,
    phone_digits: digits ? digits : null,
    photo_path: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), ...overrides };
}

function experience(company: string | null): Profile["experiences"][number] {
  return { title: "Contrôleuse de gestion", company, start: "2019", end: null, description: null };
}

/** The lookups over a fixed set of rows; `calls` records which key was tried, in order. */
function fakeDb(rows: CandidateRow[], calls: string[]): DedupDb {
  const first = (matches: (row: CandidateRow) => boolean) => rows.find(matches) ?? null;
  return {
    getCandidateById: async (orgId, id) => {
      calls.push("pinned");
      return first((row) => row.org_id === orgId && row.id === id);
    },
    findCandidateByEmail: async (orgId, email) => {
      calls.push(`email:${email}`);
      return first((row) => row.org_id === orgId && (row.email ?? "").toLowerCase() === email);
    },
    findCandidateByPhoneDigits: async (orgId, digits) => {
      calls.push(`phone:${digits}`);
      return first((row) => row.org_id === orgId && (row.phone_digits ?? "").endsWith(digits));
    },
    findCandidateByFingerprint: async (orgId, fingerprint) => {
      calls.push(`fingerprint:${fingerprint}`);
      return first((row) => row.org_id === orgId && row.fingerprint === fingerprint);
    },
  };
}

const unpinned = { candidate_id: null };

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("keys", () => {
  it("lowercases and trims the email, keeps the digits of a phone, takes its last nine", () => {
    expect(emailKeyOf("  Marie.Dupont@Example.com ")).toBe("marie.dupont@example.com");
    expect(emailKeyOf("   ")).toBeNull();
    expect(emailKeyOf(null)).toBeNull();
    expect(phoneDigitsOf("+33 (0)6 12-34.56 78")).toBe("330612345678");
    expect(phoneDigitsOf(null)).toBe("");
    expect(PHONE_MATCH_DIGITS).toBe(9);
    expect(phoneKeyOf("+33 6 12 34 56 78")).toBe("612345678");
    expect(phoneKeyOf("06.12.34.56.78")).toBe("612345678");
    expect(phoneKeyOf("12 34 56 78")).toBeNull();
    expect(phoneKeyOf(null)).toBeNull();
  });
});

describe("namesDisagree", () => {
  it("splits a name into normalised words", () => {
    expect(nameTokensOf("Marie-Claire DUPONT")).toEqual(["marie", "claire", "dupont"]);
    expect(nameTokensOf("M. Dupont")).toEqual(["m", "dupont"]);
    expect(nameTokensOf("  ")).toEqual([]);
    expect(nameTokensOf(null)).toEqual([]);
  });

  it("says two people only when both names are full and share no word", () => {
    expect(namesDisagree("Jean Martin", "Marie Dupont")).toBe(true);
    expect(namesDisagree("Jean-Pierre Martin", "Marie Dupont")).toBe(true);
    expect(namesDisagree("M. Dupont", "Marie Dupont")).toBe(false);
    expect(namesDisagree("DUPONT Marie", "Marie Dupont")).toBe(false);
    expect(namesDisagree("Marie-Claire Dupont", "Marie Dupont")).toBe(false);
    expect(namesDisagree("Jean Dupont", "Marie Dupont")).toBe(false);
    expect(namesDisagree("Marie", "Jean Martin")).toBe(false);
    expect(namesDisagree(null, "Jean Martin")).toBe(false);
    expect(namesDisagree("", "")).toBe(false);
  });
});

describe("findExistingCandidate", () => {
  it("takes the pinned candidate first, before any contact detail", async () => {
    const pinned = candidate({
      id: "44444444-4444-4444-8444-000000000002",
      email: "someone.else@example.com",
    });
    const byEmail = candidate({ email: "marie.dupont@example.com" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([pinned, byEmail], calls),
      ORG,
      { candidate_id: pinned.id },
      profile({ email: "marie.dupont@example.com" }),
    );
    expect(match).toEqual({ candidate: pinned, by: "pinned" });
    expect(calls).toEqual(["pinned"]);
  });

  it("falls through when the pinned candidate is gone or belongs to another organisation", async () => {
    const elsewhere = candidate({
      id: "44444444-4444-4444-8444-000000000002",
      org_id: OTHER_ORG,
    });
    const byEmail = candidate({ email: "marie.dupont@example.com" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([elsewhere, byEmail], calls),
      ORG,
      { candidate_id: elsewhere.id },
      profile({ email: "Marie.Dupont@example.com" }),
    );
    expect(match).toEqual({ candidate: byEmail, by: "email" });
    expect(calls).toEqual(["pinned", "email:marie.dupont@example.com"]);
  });

  it("matches the email whatever its case, before the phone", async () => {
    const row = candidate({ email: "Marie.Dupont@Example.com", phone: "06 12 34 56 78" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([row], calls),
      ORG,
      unpinned,
      profile({ email: " MARIE.DUPONT@EXAMPLE.COM ", phone: "+33 6 12 34 56 78" }),
    );
    expect(match).toEqual({ candidate: row, by: "email" });
    expect(calls).toEqual(["email:marie.dupont@example.com"]);
  });

  it("matches the phone by its last nine digits when the email finds nothing", async () => {
    const row = candidate({ phone: "06.12.34.56.78" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([row], calls),
      ORG,
      unpinned,
      profile({ email: "new.address@example.com", phone: "+33 6 12 34 56 78" }),
    );
    expect(match).toEqual({ candidate: row, by: "phone" });
    expect(calls).toEqual(["email:new.address@example.com", "phone:612345678"]);
  });

  it("skips the phone lookup for a number of fewer than nine digits", async () => {
    const row = candidate({ phone: "12 34 56 78" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([row], calls),
      ORG,
      unpinned,
      profile({ full_name: "Marie Dupont", phone: "12 34 56 78" }),
    );
    expect(match).toBeNull();
    expect(calls).toEqual(["fingerprint:marie dupont|12345678"]);
  });

  it("refuses an email or phone hit when the names say two people, and takes it when they may be one", async () => {
    const agency = candidate({
      full_name: "Jean Martin",
      email: "contact@agence.example.com",
      phone: "01 23 45 67 89",
      fingerprint: "contact@agence.example.com",
    });
    const calls: string[] = [];
    expect(
      await findExistingCandidate(
        fakeDb([agency], calls),
        ORG,
        unpinned,
        profile({ full_name: "Marie Dupont", email: "contact@agence.example.com", phone: "01 23 45 67 89" }),
      ),
    ).toBeNull();
    // The email and the phone were both tried and refused; the fingerprint
    // is the email, already covered, so it is not tried again.
    expect(calls).toEqual(["email:contact@agence.example.com", "phone:123456789"]);

    const initial = await findExistingCandidate(
      fakeDb([agency], []),
      ORG,
      unpinned,
      profile({ full_name: "M. Martin", email: "contact@agence.example.com" }),
    );
    expect(initial).toEqual({ candidate: agency, by: "email" });

    const unnamed = await findExistingCandidate(
      fakeDb([agency], []),
      ORG,
      unpinned,
      profile({ full_name: null, phone: "+33 1 23 45 67 89" }),
    );
    expect(unnamed).toEqual({ candidate: agency, by: "phone" });
  });

  it("falls through to the next key after a refused hit", async () => {
    const shared = candidate({
      id: "44444444-4444-4444-8444-000000000002",
      full_name: "Jean Martin",
      email: "famille@example.com",
    });
    const same = candidate({ full_name: "Marie Dupont", phone: "06 12 34 56 78" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([shared, same], calls),
      ORG,
      unpinned,
      profile({ full_name: "Marie Dupont", email: "famille@example.com", phone: "06 12 34 56 78" }),
    );
    expect(match).toEqual({ candidate: same, by: "phone" });
    expect(calls).toEqual(["email:famille@example.com", "phone:612345678"]);
  });

  it("matches the fingerprint last: the name with the latest company", async () => {
    const row = candidate({ fingerprint: "marie dupont|groupe alpha" });
    const calls: string[] = [];
    const match = await findExistingCandidate(
      fakeDb([row], calls),
      ORG,
      unpinned,
      profile({ full_name: "Marie DUPONT", experiences: [experience("Groupe Alpha")] }),
    );
    expect(match).toEqual({ candidate: row, by: "fingerprint" });
    expect(calls).toEqual(["fingerprint:marie dupont|groupe alpha"]);
  });

  it("never merges on a name alone, and never across organisations", async () => {
    const namesake = candidate({ fingerprint: null, full_name: "Marie Dupont" });
    const calls: string[] = [];
    expect(
      await findExistingCandidate(
        fakeDb([namesake], calls),
        ORG,
        unpinned,
        profile({ full_name: "Marie Dupont" }),
      ),
    ).toBeNull();
    expect(calls).toEqual([]);

    const elsewhere = candidate({
      org_id: OTHER_ORG,
      email: "marie.dupont@example.com",
      phone: "06 12 34 56 78",
      fingerprint: "marie.dupont@example.com",
    });
    expect(
      await findExistingCandidate(
        fakeDb([elsewhere], []),
        ORG,
        unpinned,
        profile({ email: "marie.dupont@example.com", phone: "06 12 34 56 78" }),
      ),
    ).toBeNull();
  });
});
