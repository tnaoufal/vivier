import { describe, expect, it } from "vitest";

import { SKILLS_SHOWN, SKILL_GROUPS, classifySkill, groupSkills, visibleSkills } from "./skills";

describe("classifySkill", () => {
  it("reads software, languages and platforms as tools, as a whole or as a word", () => {
    expect(classifySkill("Figma")).toBe("tools");
    expect(classifySkill("Excel avancé")).toBe("tools");
    expect(classifySkill("Python 3")).toBe("tools");
    expect(classifySkill("Power BI")).toBe("tools");
    expect(classifySkill("Node.js")).toBe("tools");
    expect(classifySkill("C++")).toBe("tools");
    expect(classifySkill("SAP S/4HANA")).toBe("tools");
  });

  it("keeps ordinary words out of the tools unless they are the whole skill", () => {
    expect(classifySkill("Word")).toBe("tools");
    expect(classifySkill("Go-to-market")).toBe("domains");
    expect(classifySkill("Teams management")).toBe("methods");
    expect(classifySkill("R")).toBe("tools");
  });

  it("reads ways of working as methods, in both languages", () => {
    expect(classifySkill("Scrum")).toBe("methods");
    expect(classifySkill("Gestion de projet")).toBe("methods");
    expect(classifySkill("Change management")).toBe("methods");
    expect(classifySkill("Négociation commerciale")).toBe("methods");
    expect(classifySkill("Leadership")).toBe("methods");
    // An accented first letter is still a word start.
    expect(classifySkill("Écoute active")).toBe("methods");
  });

  it("puts a tool before a method when both words appear", () => {
    expect(classifySkill("Jira (gestion de projet)")).toBe("tools");
  });

  it("leaves everything else as a domain, the empty included", () => {
    expect(classifySkill("Finance d'entreprise")).toBe("domains");
    expect(classifySkill("B2B SaaS")).toBe("domains");
    expect(classifySkill("Droit du travail")).toBe("domains");
    expect(classifySkill("   ")).toBe("domains");
  });
});

describe("groupSkills", () => {
  it("keeps the CV's order inside each group and drops empties", () => {
    expect(groupSkills(["Comptabilité", "SAP", " ", "Scrum", "Excel", "Audit", "Paie"])).toEqual({
      domains: ["Comptabilité", "Paie"],
      tools: ["SAP", "Excel"],
      methods: ["Scrum", "Audit"],
    });
    expect(groupSkills(null)).toEqual({ domains: [], tools: [], methods: [] });
    expect(SKILL_GROUPS).toEqual(["domains", "tools", "methods"]);
  });
});

describe("visibleSkills", () => {
  const twelve = Array.from({ length: 12 }, (_, index) => `s${index + 1}`);

  it("shows the first eight and counts the rest", () => {
    expect(SKILLS_SHOWN).toBe(8);
    expect(visibleSkills(twelve, false)).toEqual({ shown: twelve.slice(0, 8), hidden: 4 });
    expect(visibleSkills(twelve, true)).toEqual({ shown: twelve, hidden: 0 });
  });

  it("hides nothing when the list fits, and trims what it shows", () => {
    expect(visibleSkills(["a", " b ", ""], false)).toEqual({ shown: ["a", "b"], hidden: 0 });
    expect(visibleSkills(undefined, false)).toEqual({ shown: [], hidden: 0 });
    expect(visibleSkills(twelve, false, 3)).toEqual({ shown: ["s1", "s2", "s3"], hidden: 9 });
  });
});
