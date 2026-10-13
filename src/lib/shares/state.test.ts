import { describe, expect, it } from "vitest";

import { expiresAtFrom, isExpiryDays, shareState } from "./state";

const now = Date.parse("2026-10-13T10:00:00Z");

describe("shareState", () => {
  it("is active before the expiry and without a revocation", () => {
    expect(shareState({ expires_at: "2026-10-20T10:00:00Z", revoked_at: null }, now)).toBe("active");
  });

  it("is expired at and after the expiry", () => {
    expect(shareState({ expires_at: "2026-10-13T10:00:00Z", revoked_at: null }, now)).toBe("expired");
    expect(shareState({ expires_at: "2026-10-01T10:00:00Z", revoked_at: null }, now)).toBe("expired");
  });

  it("is revoked whenever revoked_at is set, even past the expiry", () => {
    expect(shareState({ expires_at: "2026-10-20T10:00:00Z", revoked_at: "2026-10-12T10:00:00Z" }, now)).toBe("revoked");
    expect(shareState({ expires_at: "2026-10-01T10:00:00Z", revoked_at: "2026-10-12T10:00:00Z" }, now)).toBe("revoked");
  });

  it("treats an unreadable date as expired, never as open", () => {
    expect(shareState({ expires_at: "not a date", revoked_at: null }, now)).toBe("expired");
  });
});

describe("expiresAtFrom", () => {
  it("adds whole days", () => {
    expect(expiresAtFrom(7, now)).toBe("2026-10-20T10:00:00.000Z");
  });

  it("clamps to the 1..30 the server accepts", () => {
    expect(expiresAtFrom(0, now)).toBe("2026-10-14T10:00:00.000Z");
    expect(expiresAtFrom(90, now)).toBe("2026-11-12T10:00:00.000Z");
  });
});

describe("isExpiryDays", () => {
  it("knows the three choices", () => {
    expect(isExpiryDays(7)).toBe(true);
    expect(isExpiryDays(14)).toBe(true);
    expect(isExpiryDays(30)).toBe(true);
    expect(isExpiryDays(3)).toBe(false);
  });
});
