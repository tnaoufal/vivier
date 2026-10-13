import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_AUTH_ERROR, friendlyAuthError } from "./auth-errors";

describe("friendlyAuthError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps the known codes to plain sentences and logs the original", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login" })).toBe(
      "Wrong email or password.",
    );
    expect(friendlyAuthError({ code: "email_not_confirmed", message: "x" })).toContain("inbox");
    expect(friendlyAuthError({ code: "user_already_exists", message: "x" })).toContain(
      "already exists",
    );
    expect(friendlyAuthError({ code: "session_not_found", message: "x" })).toContain(
      "Sign in again",
    );
    expect(warn).toHaveBeenCalled();
  });

  it("reads a fetch failure as a connection problem", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(friendlyAuthError(new TypeError("Failed to fetch"))).toContain("connection");
    expect(friendlyAuthError({ message: "Load failed" })).toContain("connection");
  });

  it("falls back to a generic sentence for anything else", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(friendlyAuthError({ code: "PGRST301", message: "JWT expired" })).toBe(
      GENERIC_AUTH_ERROR,
    );
    expect(friendlyAuthError(null)).toBe(GENERIC_AUTH_ERROR);
    expect(friendlyAuthError("boom")).toBe(GENERIC_AUTH_ERROR);
  });
});
