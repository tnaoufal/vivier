import { describe, expect, it } from "vitest";

import {
  KEY_SKILLS,
  confidenceTone,
  currentPosition,
  dateInputToIso,
  dateInputValue,
  displayName,
  distinctSkills,
  distinctTags,
  documentTone,
  durationLabel,
  durationMonths,
  formatBytes,
  formatCount,
  formatDateRange,
  formatDuration,
  headerLine,
  keySkills,
  languagesLine,
  languagesSummary,
  listLine,
  metaLine,
  monthIndex,
  parseYearsMin,
  topSkills,
  yearsLabel,
} from "./format";

describe("confidenceTone", () => {
  it("keeps quiet above 0.8 and when the field was never read", () => {
    expect(confidenceTone(0.95)).toBe("none");
    expect(confidenceTone(0.8)).toBe("none");
    expect(confidenceTone(undefined)).toBe("none");
    expect(confidenceTone(null)).toBe("none");
    expect(confidenceTone(Number.NaN)).toBe("none");
  });

  it("asks for a check between 0.5 and 0.8, and doubts below", () => {
    expect(confidenceTone(0.79)).toBe("caution");
    expect(confidenceTone(0.5)).toBe("caution");
    expect(confidenceTone(0.49)).toBe("negative");
    expect(confidenceTone(0)).toBe("negative");
  });
});

describe("formatBytes", () => {
  it("speaks both languages in powers of 1024", () => {
    expect(formatBytes(12, "en")).toBe("12 B");
    expect(formatBytes(12, "fr")).toBe("12 o");
    expect(formatBytes(1536, "en")).toMatch(/^1\.5 KB$/);
    expect(formatBytes(1536, "fr")).toMatch(/^1,5 Ko$/);
    expect(formatBytes(26214400, "en")).toBe("25 MB");
    expect(formatBytes(26214400, "fr")).toBe("25 Mo");
    expect(formatBytes(-5, "en")).toBe("0 B");
  });
});

describe("formatCount", () => {
  it("groups thousands the way the locale does and never shows a negative count", () => {
    expect(formatCount("en", 10000)).toBe("10,000");
    expect(formatCount("fr", 10000)).toMatch(/^10\s000$/);
    expect(formatCount("en", 7)).toBe("7");
    expect(formatCount("en", -3)).toBe("0");
    expect(formatCount("fr", Number.NaN)).toBe("0");
  });
});

describe("formatDateRange", () => {
  it("shows the years of a range", () => {
    expect(formatDateRange("fr", "2019-03", "2023-01")).toBe("2019 – 2023");
    expect(formatDateRange("en", "2019", "2019")).toBe("2019");
  });

  it("says since / until when one end is missing", () => {
    expect(formatDateRange("fr", "2021-06", null)).toBe("depuis 2021");
    expect(formatDateRange("en", "2021", null)).toBe("since 2021");
    expect(formatDateRange("fr", null, "2023")).toBe("jusqu'en 2023");
    expect(formatDateRange("en", null, "2023")).toBe("until 2023");
    expect(formatDateRange("en", null, null)).toBe("");
    expect(formatDateRange("en", " ", "")).toBe("");
  });

  it("keeps a value that is not a year as written", () => {
    expect(formatDateRange("en", "2020", "present")).toBe("2020 – present");
  });
});

describe("yearsLabel", () => {
  it("agrees the unit with the number", () => {
    expect(yearsLabel("fr", 1)).toBe("1 an");
    expect(yearsLabel("fr", 3)).toBe("3 ans");
    expect(yearsLabel("fr", 2.5)).toBe("2,5 ans");
    expect(yearsLabel("en", 1)).toBe("1 year");
    expect(yearsLabel("en", 0.5)).toBe("0.5 years");
    expect(yearsLabel("en", null)).toBe("");
  });

  it("agrees the unit with the rounded figure it shows", () => {
    expect(yearsLabel("fr", 1.96)).toBe("2 ans");
    expect(yearsLabel("fr", 1.04)).toBe("1 an");
    expect(yearsLabel("en", 1.04)).toBe("1 year");
    expect(yearsLabel("en", 0.96)).toBe("1 year");
    expect(yearsLabel("en", 1.96)).toBe("2 years");
  });
});

describe("row summaries", () => {
  it("falls back to the placeholder for a nameless profile", () => {
    expect(displayName({ full_name: "  " }, "Sans nom")).toBe("Sans nom");
    expect(displayName({ full_name: " Ana Lu " }, "Sans nom")).toBe("Ana Lu");
  });

  it("lists languages with their level", () => {
    expect(
      languagesLine([
        { name: "Anglais", level: "C1" },
        { name: "Espagnol", level: null },
      ]),
    ).toBe("Anglais (C1), Espagnol");
    expect(languagesLine([])).toBe("");
  });

  it("reads the languages as a sheet's head does, the level after the name", () => {
    expect(
      languagesSummary([
        { name: " Français ", level: "C2" },
        { name: "Anglais", level: " B2 " },
        { name: "Arabe", level: null },
        { name: "  ", level: "A1" },
      ]),
    ).toBe("Français C2 · Anglais B2 · Arabe");
    expect(languagesSummary([])).toBe("");
    expect(languagesSummary(null)).toBe("");
  });

  it("keeps the first skills only", () => {
    expect(topSkills(["a", " ", "b", "c", "d", "e"], 4)).toEqual(["a", "b", "c", "d"]);
    expect(topSkills(null, 4)).toEqual([]);
  });

  it("collects distinct tags in order", () => {
    expect(distinctTags([{ tags: ["b", "a"] }, { tags: ["a", " c "] }])).toEqual(["b", "a", "c"]);
  });

  it("collects distinct skills in order, for the filter's suggestions", () => {
    expect(
      distinctSkills([{ skills: ["Python", " SQL "] }, { skills: ["SQL", "", "dbt"] }]),
    ).toEqual(["Python", "SQL", "dbt"]);
    expect(distinctSkills([])).toEqual([]);
  });

  it("keeps the three key skills the CV put first", () => {
    expect(KEY_SKILLS).toBe(3);
    expect(keySkills(["Figma", " ", "Design systems", "Prototypage", "Recherche"])).toEqual([
      "Figma",
      "Design systems",
      "Prototypage",
    ]);
    expect(keySkills(["a", "b"], 1)).toEqual(["a"]);
    expect(keySkills(undefined)).toEqual([]);
  });

  it("tones a document status", () => {
    expect(documentTone("processed")).toBe("positive");
    expect(documentTone("failed")).toBe("negative");
    expect(documentTone("needs_ocr")).toBe("caution");
    expect(documentTone("processing")).toBe("primary");
    expect(documentTone("queued")).toBe("neutral");
    // Set aside is not a failure of the service: the file was read and is not a CV.
    expect(documentTone("rejected")).toBe("neutral");
  });
});

describe("parseYearsMin", () => {
  it("reads a whole number of years and nothing else", () => {
    expect(parseYearsMin(" 5 ")).toBe(5);
    expect(parseYearsMin("70")).toBe(70);
    expect(parseYearsMin("0")).toBeNull();
    expect(parseYearsMin("71")).toBeNull();
    expect(parseYearsMin("2.5")).toBeNull();
    expect(parseYearsMin("")).toBeNull();
    expect(parseYearsMin("abc")).toBeNull();
  });
});

describe("date inputs", () => {
  it("round-trips a day", () => {
    expect(dateInputValue("2026-10-13T08:00:00.000Z")).toBe("2026-10-13");
    expect(dateInputValue(null)).toBe("");
    expect(dateInputToIso("2026-10-13")).toBe("2026-10-13T12:00:00.000Z");
    expect(dateInputToIso("")).toBeNull();
    expect(dateInputToIso("13/10/2026")).toBeNull();
  });
});

describe("currentPosition", () => {
  const experience = (title: string, company: string | null, end: string | null) => ({
    title,
    company,
    start: "2020-01",
    end,
    description: null,
  });

  it("reads the first experience without an end", () => {
    expect(
      currentPosition({
        headline: "Designer",
        experiences: [
          experience("Lead designer", "Acme ", null),
          experience("Designer", "Beta", null),
        ],
      }),
    ).toEqual({ title: "Lead designer", company: "Acme" });
  });

  it("skips ended positions and empty titles, then falls back to the headline", () => {
    expect(
      currentPosition({
        headline: " Product designer ",
        experiences: [experience("Designer", "Beta", "2023-06"), experience("  ", "Gamma", null)],
      }),
    ).toEqual({ title: "Product designer", company: null });
    // An end that is not a date is still a value the CV wrote: the position ended.
    expect(
      currentPosition({ headline: null, experiences: [experience("Designer", "Beta", "present")] }),
    ).toBeNull();
    expect(currentPosition({ headline: "  ", experiences: [] })).toBeNull();
    expect(currentPosition({ headline: null })).toBeNull();
  });

  it("leaves the company null when the CV names none", () => {
    expect(
      currentPosition({ headline: null, experiences: [experience("Freelance", "", null)] }),
    ).toEqual({
      title: "Freelance",
      company: null,
    });
  });
});

describe("metaLine", () => {
  it("joins what the CV states, the seniority first, and nothing else", () => {
    expect(
      metaLine("fr", { location: "Paris", years_experience: 6, availability: "Janvier" }),
    ).toBe("6 ans · Paris · Janvier");
    expect(metaLine("en", { location: " Lyon ", years_experience: null, availability: null })).toBe(
      "Lyon",
    );
    expect(metaLine("en", { location: null, years_experience: 1, availability: " " })).toBe(
      "1 year",
    );
    expect(metaLine("fr", { location: null, years_experience: null, availability: null })).toBe("");
  });
});

describe("listLine", () => {
  it("reads the seniority, the location, then the three key skills", () => {
    expect(
      listLine("fr", {
        location: " Casablanca ",
        years_experience: 12,
        skills: ["Python", "SAP", " MS Project ", "Excel"],
      }),
    ).toBe("12 ans · Casablanca · Python, SAP, MS Project");
    expect(listLine("en", { location: null, years_experience: 2.5, skills: [] })).toBe("2.5 years");
    expect(listLine("en", { location: "Lyon", years_experience: null, skills: null })).toBe("Lyon");
    expect(listLine("fr", { location: null, years_experience: null, skills: [" "] })).toBe("");
  });
});

describe("headerLine", () => {
  it("reminds the position held today, the years and the place", () => {
    expect(
      headerLine("fr", {
        headline: "Designer",
        location: "Casablanca",
        years_experience: 12,
        experiences: [
          {
            title: "Lead designer",
            company: "Acme",
            start: "2020-01",
            end: null,
            description: null,
          },
        ],
      }),
    ).toBe("Lead designer · 12 ans · Casablanca");
    expect(
      headerLine("en", { headline: " Product designer ", location: null, years_experience: null }),
    ).toBe("Product designer");
    expect(headerLine("en", { headline: null, location: null, years_experience: null })).toBe("");
  });
});

describe("durations", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("indexes a month, a year alone at its first or last month", () => {
    expect(monthIndex("2021-06", "start")).toBe(2021 * 12 + 5);
    expect(monthIndex("2021", "start")).toBe(2021 * 12);
    expect(monthIndex("2021", "end")).toBe(2021 * 12 + 11);
    expect(monthIndex("2021-13", "end")).toBeNull();
    expect(monthIndex("present", "end")).toBeNull();
    expect(monthIndex(" ", "end")).toBeNull();
    expect(monthIndex("20211", "start")).toBeNull();
  });

  it("counts both ends and runs to today when the end is empty", () => {
    expect(durationMonths("2019-01", "2019-12")).toBe(12);
    expect(durationMonths("2019", "2019")).toBe(12);
    expect(durationMonths("2021-06", null, now)).toBe(65);
    expect(durationMonths("2026-10", "", now)).toBe(1);
  });

  it("estimates nothing it cannot read", () => {
    expect(durationMonths(null, "2020")).toBeNull();
    expect(durationMonths("2020", "present")).toBeNull();
    expect(durationMonths("2022-03", "2021-01")).toBeNull();
  });

  it("speaks both languages and agrees the units", () => {
    expect(durationLabel("fr", 1)).toBe("1 mois");
    expect(durationLabel("fr", 12)).toBe("1 an");
    expect(durationLabel("fr", 28)).toBe("2 ans 4 mois");
    expect(durationLabel("en", 1)).toBe("1 month");
    expect(durationLabel("en", 13)).toBe("1 year 1 month");
    expect(durationLabel("en", 36)).toBe("3 years");
    expect(durationLabel("en", 0)).toBe("");
    expect(durationLabel("en", null)).toBe("");
  });

  it("formats an experience's duration in one call", () => {
    expect(formatDuration("fr", "2021-06", null, now)).toBe("5 ans 5 mois");
    expect(formatDuration("en", "2019", "2019")).toBe("1 year");
    expect(formatDuration("en", null, null)).toBe("");
  });
});
