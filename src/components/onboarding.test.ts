import { describe, expect, it } from "vitest";

import { personalSpaceName, slugOf } from "./onboarding";

describe("slugOf", () => {
  it("writes a lower-case ascii slug with a tail", () => {
    expect(slugOf("Groupe Lumière RH", "ab12")).toBe("groupe-lumiere-rh-ab12");
    expect(slugOf("   ", "ab12")).toBe("org-ab12");
    expect(slugOf("A".repeat(80), "x1")).toMatch(/^a{30}-x1$/);
  });

  it("slugs a person's name for a personal space", () => {
    expect(slugOf("Naoufal T.", "k9z2")).toBe("naoufal-t-k9z2");
    expect(slugOf("Ana.lu", "k9z2")).toBe("ana-lu-k9z2");
  });
});

describe("personalSpaceName", () => {
  it("takes the display name first, trimmed", () => {
    expect(personalSpaceName("Ana Lu", "ana@x.fr", "Espace personnel")).toBe("Ana Lu");
    expect(personalSpaceName("  Ana Lu  ", "ana@x.fr", "Espace personnel")).toBe("Ana Lu");
  });

  it("falls back to the email's local part with a capital", () => {
    expect(personalSpaceName(null, "ana.lu@x.fr", "Espace personnel")).toBe("Ana.lu");
    expect(personalSpaceName(" ", "naoufal@x.fr", "Espace personnel")).toBe("Naoufal");
    expect(personalSpaceName(undefined, "élodie@x.fr", "Espace personnel")).toBe("Élodie");
  });

  it("then to the fallback", () => {
    expect(personalSpaceName(undefined, undefined, "Espace personnel")).toBe("Espace personnel");
    expect(personalSpaceName("", "@x.fr", "Personal space")).toBe("Personal space");
    expect(personalSpaceName(null, null, "Espace personnel")).toBe("Espace personnel");
  });

  it("never exceeds the database's 120 characters", () => {
    expect(personalSpaceName("a".repeat(200), null, "?")).toHaveLength(120);
    expect(personalSpaceName(null, `${"b".repeat(200)}@x.fr`, "?")).toHaveLength(120);
  });
});
