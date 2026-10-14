import { describe, expect, it } from "vitest";

import type { RoleProfile } from "@/lib/db/types";

import { VALUE_MAX } from "./criteria";
import {
  cleanRoleProfile,
  clipList,
  DEFAULT_SENIORITY,
  emptyRoleProfile,
  guardRoleProfile,
  isSeniority,
  parseRoleProfile,
  protectedRoleText,
  ROLE_MISSIONS_MAX,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  ROLE_ASSUMPTIONS_MAX,
  ROLE_SENIORITIES,
  roleDefinitionOf,
  roleProfileAnswer,
  roleProfileSystemPrompt,
  roleProfileUserPrompt,
  seniorityKey,
  statesMaximumYears,
} from "./role-profile";

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

  it("reads a stored profile back as it is", () => {
    expect(parseRoleProfile(full)).toEqual(full);
    expect(parseRoleProfile(JSON.parse(JSON.stringify(full)))).toEqual(full);
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

describe("cleanRoleProfile and clipList", () => {
  it("takes the defaults for the title, the model and the date the input lacks", () => {
    const defaults = {
      title: "Contrôleur de gestion",
      model: "m",
      createdAt: "2026-10-14T00:00:00Z",
    };
    const profile = cleanRoleProfile(
      { domain: "Finance", seniority: "senior", missions: ["a", "b", "c"] },
      defaults,
    );
    expect(profile).toMatchObject({
      title: "Contrôleur de gestion",
      domain: "Finance",
      seniority: "senior",
      model: "m",
      createdAt: defaults.createdAt,
    });
    // The input's own title, model and date win when it has them.
    expect(cleanRoleProfile(full, defaults)).toEqual(full);
    expect(cleanRoleProfile({ model: "  " }, defaults).model).toBe("m");
  });

  it("drops blanks and repeats (case apart) and clips each item", () => {
    expect(clipList(["Vendre", " vendre ", "", "  ", "Négocier"])).toEqual(["Vendre", "Négocier"]);
    expect(clipList("x")).toEqual([]);
    expect(clipList([1, null, "ok"])).toEqual(["ok"]);
    expect(clipList(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(clipList(["x".repeat(500)])[0]).toHaveLength(ROLE_PROFILE_ITEM_MAX);
  });
});

describe("emptyRoleProfile", () => {
  it("holds the title, the date given, and nothing else", () => {
    const empty = emptyRoleProfile(" Business Developer ", "2026-01-01T00:00:00Z");
    expect(empty).toEqual({
      title: "Business Developer",
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
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(emptyRoleProfile("T").createdAt).not.toBe("");
  });
});

describe("guardRoleProfile", () => {
  it("drops every field that names a protected characteristic and counts them, the wider words left alone", () => {
    const { profile, dropped } = guardRoleProfile({
      ...full,
      title: "Nationality officer",
      domain: "Vente aux particuliers (famille de produits électroménager)",
      missions: ["Prospecter", "Recruter une femme de moins de 30 ans", "Signer"],
      adjacentProfiles: ["Âge inférieur à 35 ans"],
      context: {
        sector: "Confession religieuse",
        product: "Politique commerciale",
        clients: null,
        scope: null,
      },
      questions: ["Date de naissance ?", "Quel cycle de vente ?"],
      assumptions: ["Le brief ne dit pas l'âge souhaité", "Le niveau est supposé senior"],
    });
    expect(dropped).toBe(6);
    expect(profile.title).toBe("");
    expect(profile.domain).toBe("Vente aux particuliers (famille de produits électroménager)");
    expect(profile.missions).toEqual(["Prospecter", "Signer"]);
    expect(profile.adjacentProfiles).toEqual([]);
    expect(profile.context).toEqual({
      sector: null,
      product: "Politique commerciale",
      clients: null,
      scope: null,
    });
    expect(profile.questions).toEqual(["Quel cycle de vente ?"]);
    expect(profile.assumptions).toEqual(["Le niveau est supposé senior"]);
    // The other fields are untouched.
    expect(profile.mustHaves).toEqual(full.mustHaves);
    expect(profile.model).toBe(full.model);
  });

  it("changes nothing and counts nothing for a clean profile", () => {
    expect(guardRoleProfile(full)).toEqual({ profile: full, dropped: 0 });
    expect(protectedRoleText("famille de produits")).toBe(false);
    expect(protectedRoleText("   ")).toBe(false);
    expect(protectedRoleText("sexe")).toBe(true);
  });
});

describe("roleDefinitionOf", () => {
  it("joins the domain, the missions and the equivalent titles, clipped to the role criterion's value", () => {
    expect(roleDefinitionOf(full)).toBe(
      "Développement commercial B2B. Prospecter de nouveaux comptes ; Négocier et signer ; Développer le chiffre d'affaires. Ingénieur d'affaires, Account executive",
    );
    const long = {
      ...full,
      domain: "d".repeat(200),
      missions: Array.from({ length: 6 }, () => "m".repeat(160)),
    };
    expect(roleDefinitionOf(long)).toHaveLength(VALUE_MAX);
  });

  it("falls back on the title, then on nothing", () => {
    const bare = emptyRoleProfile("Business Developer", "2026-01-01T00:00:00Z");
    expect(roleDefinitionOf(bare)).toBe("Business Developer");
    expect(roleDefinitionOf({ ...bare, missions: ["Prospecter"] })).toBe("Prospecter");
    expect(roleDefinitionOf({ ...bare, title: "  " })).toBe("");
  });
});

describe("the answer schema and the prompt", () => {
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

  it("briefs a junior recruiter: the domain from the market, the context only when stated, never a protected characteristic", () => {
    const system = roleProfileSystemPrompt();
    expect(system).toContain('"assumptions":["..."]');
    expect(system).toContain("what the brief does not state and you had to assume");
    expect(system).toContain("before any CV is read");
    expect(system).toContain('"domain":"..."');
    expect(system).toContain('"seniority":"junior|confirmed|senior|manager|executive"');
    expect(system).toContain('"adjacentProfiles"');
    expect(system).toContain('"mustHaves"');
    expect(system).toContain('"questions"');
    expect(system).toContain("as it is in the market");
    expect(system).toContain(`${ROLE_MISSIONS_MIN} to ${ROLE_MISSIONS_MAX} core missions`);
    expect(system).toContain("ONLY when the brief states them");
    expect(system).toContain("three to five points to verify in an interview");
    // A ceiling on years is the brief's to state, never the model's to infer: the classic indirect age criterion.
    expect(system).toContain("yearsMax: ONLY when the brief itself states a maximum");
    expect(system).toContain("never infer one from the level");
    expect(system).toContain("proxy for age");
    expect(system).not.toContain("yearsMin and yearsMax: the years");
    expect(system).toContain('"yearsMax":null');
    expect(system).toContain("Never a protected characteristic");
    expect(system).toContain('not "family" or "famille"');
    expect(system).toContain("The team edits what you write");
    expect(roleProfileUserPrompt({ title: " T ", description: "" })).toBe(
      "Title: T\n\nBrief:\n(no description)",
    );
    expect(roleProfileUserPrompt({ title: "T", description: " Le besoin. " })).toBe(
      "Title: T\n\nBrief:\nLe besoin.",
    );
  });

  it("names the seniorities and their keys", () => {
    expect(ROLE_SENIORITIES).toEqual(["junior", "confirmed", "senior", "manager", "executive"]);
    expect(isSeniority("manager")).toBe(true);
    expect(isSeniority("boss")).toBe(false);
    expect(isSeniority(null)).toBe(false);
    expect(seniorityKey("senior")).toBe("briefs.seniority.senior");
  });
});

describe("statesMaximumYears", () => {
  it("is true only when the brief itself writes a ceiling on years, accents and case apart", () => {
    for (const description of [
      "De 5 à 8 ans d'expérience maximum.",
      "8 ans max dans le métier",
      "Au plus 10 ans d'expérience",
      "Pas plus de 5 ans d'expérience",
      "Jusqu'à 8 ans d'expérience",
      "Up to 8 years of experience",
      "No more than 10 years in the role",
      "Moins de 3 ans d'expérience (profil junior)",
      "MAXIMUM 6 ANS",
    ]) {
      expect(statesMaximumYears({ title: "T", description })).toBe(true);
    }
    expect(statesMaximumYears({ title: "Contrôleur 8 ans max", description: "" })).toBe(true);
  });

  it("is false for a minimum, a plain number of years, or a maximum about something else", () => {
    for (const description of [
      "5 ans d'expérience minimum.",
      "Senior, 8 ans d'expérience.",
      "Au moins 3 ans en contrôle de gestion.",
      "Budget maximum 2 M€ ; 3 ans d'expérience.",
      "Maximum de 3 recrutements par an.",
      "",
    ]) {
      expect(statesMaximumYears({ title: "T", description })).toBe(false);
    }
  });
});
