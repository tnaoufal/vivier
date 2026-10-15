import { describe, expect, it } from "vitest";

import type { RoleProfile } from "@/lib/db/types";

import {
  briefSourceHash,
  DEFAULT_SENIORITY,
  needsDerivation,
  parseRoleProfile,
  ROLE_ASSUMPTIONS_MAX,
  ROLE_MISSIONS_MAX,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  roleProfileAnswer,
} from "./role-profile";

// The parser of a stored role profile and the schema of the model's
// answer are the web app's (zod); the clean-up and the rules they rest
// on are the shared package's, tested next to it
// (packages/analysis/src/role-profile.test.ts).

const full: RoleProfile = {
  title: "Business Developer",
  domain: "Développement commercial B2B",
  seniority: "senior",
  yearsMin: 5,
  yearsMax: 10,
  missions: [
    "Prospecter de nouveaux comptes",
    "Négocier et signer",
    "Développer le chiffre d'affaires",
  ],
  equivalentTitles: ["Ingénieur d'affaires", "Account executive"],
  adjacentProfiles: ["Account manager : fidélise, ne conquiert pas"],
  context: { sector: "SaaS", product: null, clients: "ETI", scope: "portefeuille 2 M€" },
  mustHaves: ["Anglais courant"],
  niceToHaves: ["CRM Salesforce"],
  successFactors: ["Tenacité en prospection"],
  questions: ["Quel cycle de vente ?"],
  assumptions: ["Le brief ne précise pas le secteur : supposé SaaS d'après le titre."],
  model: "mistral-large-latest",
  createdAt: "2026-10-14T09:00:00Z",
};

describe("parseRoleProfile", () => {
  it("answers null for nothing, a scalar, a list, or a shape the schema refuses", () => {
    expect(parseRoleProfile(null)).toBeNull();
    expect(parseRoleProfile(undefined)).toBeNull();
    expect(parseRoleProfile("x")).toBeNull();
    expect(parseRoleProfile([])).toBeNull();
    expect(parseRoleProfile({ missions: "not a list" })).toBeNull();
    expect(parseRoleProfile({ yearsMin: "five" })).toBeNull();
  });

  it("reads a stored profile back as it is, the hash of its text with it", () => {
    expect(parseRoleProfile(full)).toEqual(full);
    expect(parseRoleProfile(JSON.parse(JSON.stringify(full)))).toEqual(full);
    const read = { ...full, sourceHash: "811c9dc5" };
    expect(parseRoleProfile(read)).toEqual(read);
    expect("sourceHash" in (parseRoleProfile(full) ?? {})).toBe(false);
  });

  it("fills what a sparse column lacks: empty texts and lists, the default seniority, null years, no model", () => {
    const sparse = parseRoleProfile({});
    expect(sparse).toEqual({
      title: "",
      domain: "",
      seniority: DEFAULT_SENIORITY,
      yearsMin: null,
      yearsMax: null,
      missions: [],
      equivalentTitles: [],
      adjacentProfiles: [],
      context: { sector: null, product: null, clients: null, scope: null },
      mustHaves: [],
      niceToHaves: [],
      successFactors: [],
      questions: [],
      assumptions: [],
      model: null,
      createdAt: "",
    });
    expect(parseRoleProfile({ context: null })?.context).toEqual({
      sector: null,
      product: null,
      clients: null,
      scope: null,
    });
  });

  it("clips texts to 200, lists to 8 items of 160, missions to 6, assumptions to 4, and binds the seniority and the years", () => {
    const profile = parseRoleProfile({
      title: ` ${"t".repeat(300)} `,
      domain: "d".repeat(300),
      seniority: "guru",
      yearsMin: 10,
      yearsMax: 5,
      missions: ["a", "b", "c", "d", "e", "f", "g"],
      equivalentTitles: Array.from({ length: 12 }, (_, index) => `title ${index}`),
      mustHaves: ["m".repeat(400)],
      assumptions: ["a1", "a2", "a3", "a4", "a5"],
      context: { sector: " Retail ", product: "", clients: "   ", scope: null },
    });
    expect(profile?.title).toHaveLength(ROLE_PROFILE_TEXT_MAX);
    expect(profile?.domain).toHaveLength(ROLE_PROFILE_TEXT_MAX);
    expect(profile?.seniority).toBe(DEFAULT_SENIORITY);
    expect(profile?.yearsMin).toBe(5);
    expect(profile?.yearsMax).toBe(10);
    expect(profile?.missions).toHaveLength(ROLE_MISSIONS_MAX);
    expect(profile?.assumptions).toEqual(["a1", "a2", "a3", "a4"]);
    expect(ROLE_ASSUMPTIONS_MAX).toBe(4);
    expect(profile?.equivalentTitles).toHaveLength(ROLE_PROFILE_LIST_MAX);
    expect(profile?.mustHaves[0]).toHaveLength(ROLE_PROFILE_ITEM_MAX);
    expect(profile?.context).toEqual({
      sector: "Retail",
      product: null,
      clients: null,
      scope: null,
    });
    expect(parseRoleProfile({ yearsMin: 100, yearsMax: -3 })).toMatchObject({
      yearsMin: 0,
      yearsMax: 60,
    });
    expect(parseRoleProfile({ yearsMin: 4.6 })?.yearsMin).toBe(5);
  });
});

describe("the answer schema", () => {
  it("asks for three missions at least and lets the optional fields go", () => {
    expect(
      roleProfileAnswer.safeParse({ domain: "x", seniority: "senior", missions: ["a", "b"] })
        .success,
    ).toBe(false);
    expect(
      roleProfileAnswer.safeParse({ domain: "x", seniority: "senior", missions: ["a", "b", "c"] })
        .success,
    ).toBe(true);
    expect(
      roleProfileAnswer.safeParse({
        domain: "x",
        seniority: "senior",
        missions: ["a", "b", "c"],
        context: null,
        yearsMin: null,
      }).success,
    ).toBe(true);
    expect(roleProfileAnswer.safeParse({ domain: "x", missions: ["a", "b", "c"] }).success).toBe(
      false,
    );
    expect(ROLE_MISSIONS_MIN).toBe(3);
  });
});

describe("needsDerivation on a profile read back from its column", () => {
  it("keeps the hash through the parser: no second reading of the same text", () => {
    const brief = { title: "T", description: "D" };
    const read = { ...full, sourceHash: briefSourceHash(brief) };
    expect(
      needsDerivation({
        ...brief,
        role_profile: parseRoleProfile(JSON.parse(JSON.stringify(read))),
      }),
    ).toBe(false);
  });
});
