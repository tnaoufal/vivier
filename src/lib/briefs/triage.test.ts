import { describe, expect, it } from "vitest";

import type { BriefCriterion, MatchResult, RoleProfile } from "@/lib/db/types";

import {
  carriesRoleName,
  countTriage,
  enforceTriage,
  isTriageVerdict,
  passesTriage,
  TRIAGE_BATCH_MAX,
  TRIAGE_CONCURRENCY,
  TRIAGE_PASSING,
  TRIAGE_PAYLOAD_MAX,
  TRIAGE_PROFILE_COLUMNS,
  TRIAGE_REASON_MAX,
  triageCard,
  triageEntries,
  triageOrder,
  triagePayload,
  triageRoleBrief,
  triageRoleTerms,
  triageSystemPrompt,
  type TriageEntry,
  type TriageProfile,
} from "./triage";

function profile(id: string, extra: Partial<TriageProfile> = {}): TriageProfile {
  return {
    id,
    full_name: null,
    location: null,
    headline: null,
    years_experience: null,
    experiences: [],
    education: [],
    skills: [],
    ...extra,
  };
}

function experience(
  title: string,
  company: string | null,
  start: string | null,
  end: string | null,
) {
  return { title, company, start, end, description: "Prospection, négociation, closing." };
}

const roleProfile: RoleProfile = {
  title: "Business Developer",
  domain: "Développement commercial B2B",
  seniority: "confirmed",
  yearsMin: 3,
  yearsMax: null,
  missions: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
  equivalentTitles: ["Chargé d'affaires", "Account Executive", "Ingénieur commercial"],
  adjacentProfiles: ["Account manager : fidélise plus qu'il ne conquiert"],
  context: { sector: "SaaS", product: null, clients: "PME", scope: null },
  mustHaves: ["a", "b", "c", "d", "e", "f", "g"],
  niceToHaves: ["Anglais"],
  successFactors: ["Ténacité"],
  questions: ["Cycle de vente ?"],
  assumptions: [],
  model: "m",
  createdAt: "2026-10-01T00:00:00Z",
};

const role: BriefCriterion = {
  id: "role",
  kind: "role",
  label: "Commercial grands comptes",
  value: "Développement commercial B2B ; prospection ; négociation",
  required: true,
  weight: 3,
};

describe("the constants", () => {
  it("bound a batch, a reason, the browser's pool and the payload", () => {
    expect(TRIAGE_BATCH_MAX).toBe(40);
    expect(TRIAGE_REASON_MAX).toBe(120);
    expect(TRIAGE_CONCURRENCY).toBe(4);
    expect(TRIAGE_PAYLOAD_MAX).toBe(16000);
  });

  it("load no contact, no link, no photo, no summary, no CV text (the name and the place only to take them out)", () => {
    const columns = TRIAGE_PROFILE_COLUMNS.split(",");
    expect(columns).toEqual([
      "id",
      "full_name",
      "location",
      "headline",
      "years_experience",
      "experiences",
      "education",
      "skills",
    ]);
    for (const column of ["email", "phone", "links", "photo_path", "summary", "search_text"])
      expect(columns).not.toContain(column);
  });
});

describe("triageCard", () => {
  // A whole candidate row: the card must take only what the triage reads.
  const row = {
    ...profile("p1", {
      full_name: "Camille Durand",
      headline:
        "  Camille Durand | Business Developer SaaS, camille.durand@mail.fr, 06 12 34 56 78 ",
      years_experience: 7.25,
      experiences: [
        experience("Account Executive", "Durand Conseil", "2016-01", "2019-12"),
        experience("Business Developer", "Acme", "2020-01", null),
        experience("Stagiaire commercial", "Foo", "2014", "2015"),
        experience("Vendeur", "Bar", "2012", "2013"),
        experience("Serveur", "Baz", "2010", "2011"),
        experience("Animateur", "Qux", "2008", "2009"),
      ],
      education: [
        { degree: "", school: "Nowhere", year: "1998" },
        { degree: "Master Commerce", school: "ESC Lille", year: "1999" },
      ],
      skills: [" Prospection ", "Négociation", "", "Prospection", "CRM"],
    }),
    email: "camille.durand@mail.fr",
    phone: "06 12 34 56 78",
    location: "Lyon",
    links: [{ label: "LinkedIn", url: "https://linkedin.com/in/cdurand" }],
    summary: "Résumé personnel très détaillé",
    search_text: "Camille Durand CV complet",
    photo_path: "org/p1.png",
  };
  const card = triageCard(row, "c1");

  it("holds the fields of the card and nothing else", () => {
    expect(Object.keys(card).sort()).toEqual(
      ["education", "current", "headline", "previous", "ref", "skills", "years"].sort(),
    );
    const json = JSON.stringify(card);
    for (const leak of [
      "Camille",
      "Durand",
      "camille.durand",
      "@",
      "06 12 34 56 78",
      "Lyon",
      "linkedin",
      "Résumé",
      "CV complet",
      "png",
      "1999",
      "Nowhere",
      "Animateur",
      "Prospection, négociation",
    ])
      expect(json).not.toContain(leak);
  });

  it("redacts the name from the headline and every text, and reads the position held today apart", () => {
    expect(card.ref).toBe("c1");
    expect(card.headline).toBe("| Business Developer SaaS, ,");
    expect(card.current).toEqual({
      title: "Business Developer",
      company: "Acme",
      since: "2020-01",
    });
    // The company named after the person loses the name too.
    expect(card.previous).toEqual([
      { title: "Account Executive", company: "Conseil", from: "2016-01", to: "2019-12" },
      { title: "Stagiaire commercial", company: "Foo", from: "2014", to: "2015" },
      { title: "Vendeur", company: "Bar", from: "2012", to: "2013" },
      { title: "Serveur", company: "Baz", from: "2010", to: "2011" },
    ]);
    expect(card.years).toBe(7.3);
    expect(card.education).toBe("Master Commerce — ESC Lille");
    expect(card.skills).toEqual(["Prospection", "Négociation", "CRM"]);
  });

  it("takes an end written as today for a position held today, and none when every position ended", () => {
    const today = triageCard(
      profile("p2", {
        experiences: [
          experience("Chargé d'affaires", "A", "2021", "Présent"),
          experience("Commercial", "B", "2018", "2020"),
        ],
      }),
      "c2",
    );
    expect(today.current).toEqual({ title: "Chargé d'affaires", company: "A", since: "2021" });
    expect(today.previous).toHaveLength(1);
    const ended = triageCard(
      profile("p3", {
        experiences: [
          experience("T1", "A", "2019", "2020"),
          experience("T2", "B", "2017", "2018"),
          experience("T3", "C", "2015", "2016"),
          experience("T4", "D", "2013", "2014"),
          experience("T5", "E", "2011", "2012"),
        ],
      }),
      "c3",
    );
    expect(ended.current).toBeNull();
    expect(ended.previous.map((position) => position.title)).toEqual(["T1", "T2", "T3", "T4"]);
  });

  it("clips every text and keeps twelve skills at most", () => {
    const long = "x".repeat(400);
    const clipped = triageCard(
      profile("p4", {
        headline: long,
        experiences: [experience(long, long, "2020-01-01T00:00:00.000Z-long", null)],
        education: [{ degree: long, school: null, year: null }],
        skills: Array.from({ length: 30 }, (_, index) => `${long}${index}`),
      }),
      "c4",
    );
    expect(clipped.headline).toHaveLength(120);
    expect(clipped.current?.title).toHaveLength(120);
    expect(clipped.current?.company).toHaveLength(120);
    expect(clipped.current?.since?.length).toBeLessThanOrEqual(20);
    expect(clipped.education).toHaveLength(120);
    expect(clipped.skills).toHaveLength(1);
    expect(clipped.skills[0]).toHaveLength(120);
    const many = triageCard(
      profile("p5", { skills: Array.from({ length: 30 }, (_, index) => `skill ${index}`) }),
      "c5",
    );
    expect(many.skills).toHaveLength(12);
    expect(many.skills[11]).toBe("skill 11");
  });

  it("takes the person's place, the links and the degree's year out of every text", () => {
    const placed = triageCard(
      profile("p7", {
        location: "Lyon (69), France",
        headline: "Commercial B2B | Lyon | linkedin.com/in/jdupont https://jdupont.fr/cv",
        experiences: [experience("Business Developer", "Acme France", "2020", null)],
        education: [{ degree: "Master Commerce 2012", school: "IAE Lyon", year: "2012" }],
        skills: ["ASP.NET/C#", "www.portfolio.example"],
      }),
      "c7",
    );
    const json = JSON.stringify(placed);
    for (const leak of ["Lyon", "France", "linkedin", "jdupont", "https", "2012", "www."])
      expect(json).not.toContain(leak);
    expect(placed.headline).toBe("Commercial B2B | |");
    expect(placed.current).toEqual({ title: "Business Developer", company: "Acme", since: "2020" });
    expect(placed.education).toBe("Master Commerce — IAE");
    // A skill written like a domain in capitals is not a link.
    expect(placed.skills).toEqual(["ASP.NET/C#"]);
  });

  it("answers an empty card for an empty profile", () => {
    expect(triageCard(profile("p6"), "c6")).toEqual({
      ref: "c6",
      headline: null,
      current: null,
      previous: [],
      years: null,
      education: null,
      skills: [],
    });
  });
});

describe("triageEntries", () => {
  it("names the cards c1..cN in the order given and keeps the ids on the server side", () => {
    const entries = triageEntries([profile("a"), profile("b"), profile("c")]);
    expect(entries.map((entry) => entry.card.ref)).toEqual(["c1", "c2", "c3"]);
    expect(entries.map((entry) => entry.candidateId)).toEqual(["a", "b", "c"]);
    expect(JSON.stringify(entries.map((entry) => entry.card))).not.toContain('"a"');
  });
});

describe("triageRoleBrief and triageRoleTerms", () => {
  it("reads the role profile alone, six missions and six must-haves at most", () => {
    const brief = triageRoleBrief({
      title: "Business Developer H/F",
      criteria: [role],
      role_profile: roleProfile,
    });
    expect(brief.title).toBe("Business Developer");
    expect(brief.domain).toBe("Développement commercial B2B");
    expect(brief.seniority).toBe("confirmed");
    expect(brief.missions).toHaveLength(6);
    expect(brief.mustHaves).toHaveLength(6);
    // The role's label (the name the job had before the team corrected the profile) is no equivalent title.
    expect(brief.equivalentTitles).toEqual(roleProfile.equivalentTitles);
    expect(JSON.stringify(brief)).not.toContain("Commercial grands comptes");
    expect(brief.adjacentProfiles).toEqual(["Account manager : fidélise plus qu'il ne conquiert"]);
    expect(brief.definition).toBeNull();
    expect(JSON.stringify(brief)).not.toContain("Ténacité");
    // A profile without a title takes the role's label, then the brief's title.
    const untitled = { ...roleProfile, title: "" };
    expect(triageRoleBrief({ title: "x", criteria: [role], role_profile: untitled }).title).toBe(
      "Commercial grands comptes",
    );
    expect(triageRoleBrief({ title: "x", criteria: [], role_profile: untitled }).title).toBe("x");
  });

  it("reads the role criterion and the brief's title when there is no profile", () => {
    const brief = triageRoleBrief({
      title: "Commercial grands comptes - Lyon",
      criteria: [role],
      role_profile: null,
    });
    expect(brief).toEqual({
      title: "Commercial grands comptes",
      domain: null,
      seniority: null,
      equivalentTitles: ["Commercial grands comptes - Lyon"],
      adjacentProfiles: [],
      missions: [],
      mustHaves: [],
      definition: "Développement commercial B2B ; prospection ; négociation",
    });
    const bare = triageRoleBrief({ title: "Comptable", criteria: [], role_profile: null });
    expect(bare.title).toBe("Comptable");
    expect(bare.equivalentTitles).toEqual([]);
    expect(bare.definition).toBeNull();
  });

  it("normalises the title and the equivalent titles, two characters at least, each once", () => {
    expect(
      triageRoleTerms({
        title: "Chargé d’Affaires",
        equivalentTitles: ["CHARGE D'AFFAIRES", "Ingénieur-commercial", "R", " RH ", ""],
      }),
    ).toEqual(["charge d'affaires", "ingenieur commercial", "rh"]);
  });

  it("leaves out the gender markers, the bracketed endings and the contract a job ad adds", () => {
    const terms = triageRoleTerms({
      title: "Comptable H/F",
      equivalentTitles: [
        "Chargé(e) d'affaires (F/H/X)",
        "Business Developer - CDI",
        "Vendeur(se) m/w/d",
      ],
    });
    expect(terms).toEqual(["comptable", "charge d'affaires", "business developer", "vendeur"]);
    const [entry] = triageEntries([profile("x", { headline: "Comptable confirmée" })]);
    expect(entry && carriesRoleName(entry.card, terms)).toBe(true);
  });
});

describe("enforceTriage", () => {
  const entries: TriageEntry[] = triageEntries([
    profile("id1", { experiences: [experience("Business Developer", "A", "2020", null)] }),
    profile("id2", { experiences: [experience("Développeur mobile", "B", "2019", null)] }),
    profile("id3", { headline: "CHARGÉ D’AFFAIRES industrie" }),
    profile("id4", { experiences: [experience("Comptable", "C", "2018", null)] }),
    profile("id5"),
  ]);
  const terms = triageRoleTerms(
    triageRoleBrief({ title: "", criteria: [], role_profile: roleProfile }),
  );

  it("keeps one verdict per card, the first answer of a ref, and ignores refs no card carries", () => {
    const outcomes = enforceTriage(
      entries,
      {
        verdicts: [
          { ref: "c1", verdict: "yes", reason: "  Business Developer chez A depuis 2020.  " },
          { ref: "c1", verdict: "no", reason: "second answer" },
          { ref: "c2", verdict: "no", reason: "Développeur mobile : un autre métier." },
          { ref: "c4", verdict: "maybe", reason: null },
          { ref: "c99", verdict: "yes", reason: "nobody" },
        ],
      },
      terms,
    );
    expect([...outcomes.keys()]).toEqual(["id1", "id2", "id3", "id4", "id5"]);
    expect(outcomes.get("id1")).toEqual({
      verdict: "yes",
      reason: "Business Developer chez A depuis 2020.",
      guarded: false,
    });
    // A shared word does not make the same job: the guard leaves this "no".
    expect(outcomes.get("id2")).toEqual({
      verdict: "no",
      reason: "Développeur mobile : un autre métier.",
      guarded: false,
    });
    // Silence is never a lack: an unanswered card is read in full.
    expect(outcomes.get("id3")).toEqual({ verdict: "unknown", reason: null, guarded: false });
    // A verdict outside the four reads unknown.
    expect(outcomes.get("id4")?.verdict).toBe("unknown");
    expect(outcomes.get("id5")?.verdict).toBe("unknown");
  });

  it("reads a verdict whatever its case and spacing, and clips the reason", () => {
    const outcomes = enforceTriage(
      entries,
      { verdicts: [{ ref: " c1 ", verdict: " CLOSE ", reason: "r".repeat(400) }] },
      terms,
    );
    expect(outcomes.get("id1")?.verdict).toBe("close");
    expect(outcomes.get("id1")?.reason).toHaveLength(TRIAGE_REASON_MAX);
    expect(
      enforceTriage(
        entries,
        { verdicts: [{ ref: "c1", verdict: "yes", reason: "   " }] },
        terms,
      ).get("id1")?.reason,
    ).toBeNull();
  });

  it("withholds a reason that names a protected characteristic or a period without a position", () => {
    const outcomes = enforceTriage(
      entries,
      {
        verdicts: [
          { ref: "c1", verdict: "yes", reason: "Candidate enceinte, chargée d'affaires." },
          { ref: "c2", verdict: "no", reason: "Sans emploi depuis 2021." },
          { ref: "c4", verdict: "no", reason: "Mère de deux enfants, comptable." },
        ],
      },
      terms,
    );
    expect(outcomes.get("id1")).toEqual({ verdict: "yes", reason: null, guarded: false });
    expect(outcomes.get("id2")?.reason).toBeNull();
    expect(outcomes.get("id4")).toEqual({ verdict: "no", reason: null, guarded: false });
  });

  it("turns a no into close when the current title or the headline carries the job's name, accents and case apart", () => {
    const outcomes = enforceTriage(
      entries,
      {
        verdicts: [
          { ref: "c1", verdict: "no", reason: "Lazy." },
          { ref: "c3", verdict: "no", reason: "Industrie." },
          { ref: "c4", verdict: "no", reason: "Comptable." },
        ],
      },
      terms,
    );
    expect(outcomes.get("id1")).toEqual({ verdict: "close", reason: "Lazy.", guarded: true });
    expect(outcomes.get("id3")).toEqual({ verdict: "close", reason: "Industrie.", guarded: true });
    expect(outcomes.get("id4")).toEqual({ verdict: "no", reason: "Comptable.", guarded: false });
    expect(countTriage(outcomes.values())).toEqual({
      yes: 0,
      close: 2,
      no: 1,
      unknown: 2,
      guarded: 2,
    });
  });

  it("reads the guard on whole words of the current title and the headline only", () => {
    const [card] = triageEntries([
      profile("x", {
        headline: "Business Developers Club",
        experiences: [
          experience("Comptable", "A", "2020", null),
          experience("Business Developer", "B", "2010", "2015"),
        ],
      }),
    ]);
    expect(card && carriesRoleName(card.card, ["business developer"])).toBe(false);
    expect(card && carriesRoleName(card.card, ["comptable"])).toBe(true);
    expect(card && carriesRoleName(card.card, [])).toBe(false);
  });
});

describe("passesTriage and isTriageVerdict", () => {
  it("reads in full everything but another job", () => {
    expect(passesTriage("yes")).toBe(true);
    expect(passesTriage("close")).toBe(true);
    expect(passesTriage("unknown")).toBe(true);
    expect(passesTriage("no")).toBe(false);
    expect(TRIAGE_PASSING).toEqual(["yes", "close", "unknown"]);
    expect(isTriageVerdict("close")).toBe(true);
    expect(isTriageVerdict("maybe")).toBe(false);
    expect(isTriageVerdict(null)).toBe(false);
  });
});

describe("triageOrder", () => {
  function result(id: string, score: number, verdict?: "yes" | "close" | "unknown"): MatchResult {
    const base: MatchResult = {
      candidateId: id,
      score,
      coverage: 1,
      blocked: false,
      verdicts: [],
      why: null,
      retrieval: { textRank: null, vectorRank: null },
    };
    return verdict ? { ...base, triage: { verdict, reason: null } } : base;
  }

  it("puts yes before close before unknown, then the deterministic score", () => {
    const sorted = [
      result("u", 90, "unknown"),
      result("c-low", 10, "close"),
      result("y-low", 20, "yes"),
      result("c-high", 80, "close"),
      result("y-high", 70, "yes"),
      result("none", 95),
    ].sort(triageOrder);
    expect(sorted.map((entry) => entry.candidateId)).toEqual([
      "y-high",
      "y-low",
      "c-high",
      "c-low",
      "none",
      "u",
    ]);
  });
});

describe("triagePayload", () => {
  const brief = triageRoleBrief({ title: "x", criteria: [role], role_profile: roleProfile });

  it("stays under the budget for forty cards with long fields, the current position kept", () => {
    const long = (label: string) => `${label} ${"lorem ipsum ".repeat(30)}`;
    const cards = triageEntries(
      Array.from({ length: TRIAGE_BATCH_MAX }, (_, index) =>
        profile(`p${index}`, {
          full_name: "Jean Martin",
          headline: long("Jean Martin headline"),
          years_experience: 12,
          experiences: Array.from({ length: 8 }, (_, position) =>
            experience(
              long(`title ${position}`),
              long("company"),
              "2001-01",
              position ? "2010-01" : null,
            ),
          ),
          education: [{ degree: long("degree"), school: long("school"), year: "1999" }],
          skills: Array.from({ length: 20 }, (_, skill) => long(`skill ${skill}`)),
        }),
      ),
    ).map((entry) => entry.card);
    const payload = triagePayload(brief, cards);
    const json = JSON.stringify(payload);
    expect(json.length).toBeLessThanOrEqual(TRIAGE_PAYLOAD_MAX);
    expect(payload.cards).toHaveLength(TRIAGE_BATCH_MAX);
    expect(payload.cards[0]?.ref).toBe("c1");
    expect(payload.cards[39]?.ref).toBe("c40");
    expect(payload.cards[0]?.current).toMatch(/^title 0/);
    expect(payload.cards[0]?.years).toBe(12);
    expect(json).not.toContain("Jean");
    expect(json).not.toContain("Martin");
    expect(json).not.toContain("1999");
  });

  it("carries everything for a small batch: positions as lines, empty fields left out", () => {
    const cards = triageEntries([
      profile("a", {
        headline: "Business Developer",
        years_experience: 5,
        experiences: [
          experience("Business Developer", "Acme", "2021-03", null),
          experience("Commercial", null, "2018", "2021"),
        ],
        education: [{ degree: "Master", school: "ESC", year: "2017" }],
        skills: ["Prospection", "CRM"],
      }),
      profile("b"),
    ]).map((entry) => entry.card);
    const payload = triagePayload(brief, cards);
    expect(payload.role).toEqual(brief);
    expect(payload.cards).toEqual([
      {
        ref: "c1",
        headline: "Business Developer",
        current: "Business Developer | Acme | since 2021-03",
        previous: ["Commercial | 2018 - 2021"],
        years: 5,
        education: "Master — ESC",
        skills: "Prospection, CRM",
      },
      { ref: "c2" },
    ]);
  });
});

describe("triageSystemPrompt", () => {
  it("asks for one verdict per ref, judges the job done and never a protected characteristic", () => {
    const prompt = triageSystemPrompt();
    expect(prompt).toContain('{"verdicts":[{"ref":"c1","verdict":"yes|close|no|unknown"');
    expect(prompt).toContain("Chargé d'affaires");
    expect(prompt).toContain('"Business Developer" is not "Développeur mobile"');
    expect(prompt).toContain('"Chef de projet IT" is not "Directeur de projets industriels"');
    expect(prompt).toContain("adjacentProfiles");
    expect(prompt).toContain("at most 15 words");
    // A thin card is read in full, never dropped.
    expect(prompt).toContain("generic");
    expect(prompt).toContain('never "no"');
    expect(prompt).toContain("protected characteristic");
    expect(prompt).toMatch(/Not judged here: the seniority, the years, the location/);
  });
});
