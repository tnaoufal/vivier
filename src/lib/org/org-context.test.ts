import { describe, expect, it } from "vitest";

import type { OrganizationRow } from "@/lib/db/types";
import { initialsOf, isPersonal, memberName, pickOrg, readShowPhotos } from "./org-context";

const org = (id: string): OrganizationRow => ({
  id,
  name: id,
  slug: id,
  locale: "fr",
  retention_months: 24,
  plan: "trial",
  seat_limit: 3,
  cv_quota_month: 200,
  show_photos: true,
  kind: "team",
  created_by: null,
  created_at: "",
  updated_at: "",
});

describe("pickOrg", () => {
  it("prefers the remembered organisation when still a member", () => {
    const list = [
      { org: org("a"), role: "owner" as const },
      { org: org("b"), role: "member" as const },
    ];
    expect(pickOrg(list, "b")?.org.id).toBe("b");
    expect(pickOrg(list, "zzz")?.org.id).toBe("a");
    expect(pickOrg([], "a")).toBeNull();
  });
});

describe("names", () => {
  it("falls back from display name to email to a placeholder", () => {
    expect(memberName({ display_name: "Ana Lu", email: "a@x.fr" }, "?")).toBe("Ana Lu");
    expect(memberName({ display_name: " ", email: "ana@x.fr" }, "?")).toBe("ana");
    expect(memberName(undefined, "Someone")).toBe("Someone");
  });

  it("builds initials from the first and last words", () => {
    expect(initialsOf("Ana Lu Torres")).toBe("AT");
    expect(initialsOf("ana")).toBe("A");
    expect(initialsOf("")).toBe("?");
  });
});

describe("readShowPhotos", () => {
  it("is on unless the organisation turned it off", () => {
    expect(readShowPhotos(org("a"))).toBe(true);
    expect(readShowPhotos({ ...org("a"), show_photos: false })).toBe(false);
  });

  it("reads as on without an organisation or without the column", () => {
    expect(readShowPhotos(null)).toBe(true);
    expect(readShowPhotos(undefined)).toBe(true);
    expect(readShowPhotos({ show_photos: undefined as unknown as boolean })).toBe(true);
  });
});

describe("isPersonal", () => {
  it("reads the kind of the space", () => {
    expect(isPersonal({ ...org("a"), kind: "personal" })).toBe(true);
    expect(isPersonal(org("a"))).toBe(false);
  });

  it("reads as a team without an organisation or without the column", () => {
    expect(isPersonal(null)).toBe(false);
    expect(isPersonal(undefined)).toBe(false);
    expect(isPersonal({ kind: undefined as unknown as "team" })).toBe(false);
  });
});
