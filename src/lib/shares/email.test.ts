import { describe, expect, it } from "vitest";

import { longDate, messageParagraphs, shareEmail, shareEmailSubject } from "./email";

const base = {
  orgName: "Lumière RH",
  senderName: "Ana Costa",
  title: "Développeur back-end senior",
  message: "",
  expiresAt: "2026-10-27T10:00:00Z",
  url: "https://vivier.app/share/abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE",
};

describe("shareEmailSubject", () => {
  it("names the organisation and the title in each language", () => {
    expect(shareEmailSubject("fr", "Lumière RH", "Shortlist A")).toBe("Lumière RH vous présente une shortlist : Shortlist A");
    expect(shareEmailSubject("en", "Lumière RH", "Shortlist A")).toBe("Lumière RH shares a shortlist with you: Shortlist A");
  });
});

describe("longDate", () => {
  it("writes the date in full in each language and never crashes", () => {
    expect(longDate("fr", "2026-10-27T10:00:00Z")).toMatch(/27 octobre 2026/);
    expect(longDate("en", "2026-10-27T10:00:00Z")).toMatch(/27 October 2026/);
    expect(longDate("fr", "nope")).toBe("nope");
  });
});

describe("messageParagraphs", () => {
  it("splits on blank lines, collapses spaces and drops empty parts", () => {
    expect(messageParagraphs("  Bonjour,\n\n\nVoici   la sélection.\n \n")).toEqual(["Bonjour,", "Voici la sélection."]);
    expect(messageParagraphs("")).toEqual([]);
  });
});

describe("shareEmail", () => {
  it("writes the French email with the sender, the message, the expiry and the confidentiality line", () => {
    const content = shareEmail({ ...base, locale: "fr", message: "Deux profils à voir en priorité." });
    expect(content.subject).toBe("Lumière RH vous présente une shortlist : Développeur back-end senior");
    expect(content.title).toBe(base.title);
    expect(content.paragraphs[0]).toBe("Ana Costa (Lumière RH) vous présente une sélection de profils : Développeur back-end senior.");
    expect(content.paragraphs[1]).toBe("Deux profils à voir en priorité.");
    expect(content.paragraphs[2]).toMatch(/^Le lien expire le 27 octobre 2026\. Les CV .* confidentiels/);
    expect(content.button).toEqual({ label: "Ouvrir la présentation", url: base.url });
    expect(content.footer).toBe("Ce lien est personnel. Vivier ne prend aucune décision à votre place.");
  });

  it("writes the English email and skips the message paragraph when there is none", () => {
    const content = shareEmail({ ...base, locale: "en" });
    expect(content.paragraphs).toHaveLength(2);
    expect(content.paragraphs[0]).toBe("Ana Costa (Lumière RH) is sharing a selection of profiles with you: Développeur back-end senior.");
    expect(content.paragraphs[1]).toMatch(/^The link expires on 27 October 2026\./);
    expect(content.button.label).toBe("Open the presentation");
    expect(content.footer).toBe("This link is personal. Vivier makes no decision on your behalf.");
  });
});
