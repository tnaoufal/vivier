import { describe, expect, it } from "vitest";

import type { RoleProfile } from "./types.js";

import { VALUE_MAX } from "./criteria.js";
import {
  briefSourceHash,
  cleanRoleProfile,
  clipList,
  DEFAULT_SENIORITY,
  emptyRoleProfile,
  fnv1a32,
  guardRoleProfile,
  isSeniority,
  jobTitleOf,
  needsDerivation,
  protectedRoleText,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_SENIORITIES,
  roleDefinitionOf,
  statesMaximumYears,
} from "./role-profile.js";

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
    // The hash of the text the profile was read from stays only when the input holds one.
    expect(cleanRoleProfile({ sourceHash: " 811c9dc5 " }, defaults).sourceHash).toBe("811c9dc5");
    expect("sourceHash" in cleanRoleProfile({ sourceHash: "  " }, defaults)).toBe(false);
    expect("sourceHash" in cleanRoleProfile({}, defaults)).toBe(false);
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

describe("the seniorities and the missions", () => {
  it("names the seniorities and asks for three missions at least", () => {
    expect(ROLE_MISSIONS_MIN).toBe(3);
    expect(ROLE_SENIORITIES).toEqual(["junior", "confirmed", "senior", "manager", "executive"]);
    expect(isSeniority("manager")).toBe(true);
    expect(isSeniority("boss")).toBe(false);
    expect(isSeniority(null)).toBe(false);
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

describe("the brief a profile is read from", () => {
  it("names the job from the title, else the first line of the text, else nothing", () => {
    expect(jobTitleOf({ title: " Business Developer ", description: "x" })).toBe(
      "Business Developer",
    );
    expect(jobTitleOf({ title: "", description: "\n Business Developer \nConquête." })).toBe(
      "Business Developer",
    );
    expect(jobTitleOf({ title: " ", description: "  " })).toBe("");
  });

  it("hashes a text with FNV-1a, 32 bits, over its UTF-8 bytes, as eight hexadecimal digits", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
    expect(fnv1a32("é")).toHaveLength(8);
    expect(fnv1a32("é")).not.toBe(fnv1a32("e"));
  });

  it("writes the UTF-8 bytes as the runtime's TextEncoder does, so a stored hash stays the same", () => {
    // The reference: the hash as it was computed before the package carried its own encoder.
    const reference = (text: string): string => {
      let hash = 0x811c9dc5;
      for (const byte of new TextEncoder().encode(text)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    };
    for (const text of [
      "Contrôleur de gestion\nLyon, anglais courant",
      "Büro – naïve façade € ß",
      "日本語のテキスト",
      "emoji 🎯 and 𝄞",
      "lone surrogate \ud83d end",
      "T\nD",
    ]) {
      expect(fnv1a32(text)).toBe(reference(text));
    }
  });

  it("hashes the title and the description as they are, a line break between them", () => {
    expect(briefSourceHash({ title: "T", description: "D" })).toBe(fnv1a32("T\nD"));
    expect(briefSourceHash({ title: "T", description: "D" })).not.toBe(
      briefSourceHash({ title: "T ", description: "D" }),
    );
  });

  it("reads the brief again when it has no profile, a profile from before the hash, or one of another text", () => {
    const brief = { title: "T", description: "D" };
    const read = { ...full, sourceHash: briefSourceHash(brief) };
    expect(needsDerivation({ ...brief, role_profile: null })).toBe(true);
    expect(needsDerivation({ ...brief, role_profile: full })).toBe(true);
    expect(needsDerivation({ ...brief, role_profile: read })).toBe(false);
    expect(needsDerivation({ ...brief, description: "D.", role_profile: read })).toBe(true);
    expect(needsDerivation({ ...brief, title: "t", role_profile: read })).toBe(true);
  });
});
