import { describe, expect, it } from "vitest";

import { invitationEmail } from "./invitation-email";

describe("invitationEmail", () => {
  it("speaks French with the inviter, the role and the link", () => {
    const content = invitationEmail({
      locale: "fr",
      orgName: "Lumière RH",
      inviterName: "Ana Lu",
      role: "member",
      link: "https://vivier.app/invite/abc",
    });
    expect(content.subject).toBe("Vous êtes invité à rejoindre Lumière RH sur Vivier");
    expect(content.paragraphs[0]).toBe("Ana Lu vous invite à rejoindre Lumière RH en tant que membre.");
    expect(content.button).toEqual({ label: "Rejoindre", url: "https://vivier.app/invite/abc" });
    expect(content.footer).toContain("7 jours");
  });

  it("speaks English when the organisation works in English", () => {
    const content = invitationEmail({
      locale: "en",
      orgName: "Acme HR",
      inviterName: "ana@acme.com",
      role: "admin",
      link: "https://vivier.app/invite/abc",
    });
    expect(content.title).toBe("You are invited to join Acme HR on Vivier");
    expect(content.paragraphs[0]).toBe("ana@acme.com invites you to join Acme HR as administrator.");
    expect(content.button.label).toBe("Join");
    expect(content.footer).toContain("7 days");
  });
});
