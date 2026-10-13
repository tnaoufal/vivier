import { describe, expect, it } from "vitest";

import { isShareUrl, shareCvPath, shareUrlOf } from "./links";

const token = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE";

describe("shareUrlOf", () => {
  it("joins the origin and the token without a double slash", () => {
    expect(shareUrlOf("https://vivier.app", token)).toBe(`https://vivier.app/share/${token}`);
    expect(shareUrlOf("https://vivier.app/", token)).toBe(`https://vivier.app/share/${token}`);
  });
});

describe("shareCvPath", () => {
  it("builds the endpoint path", () => {
    expect(shareCvPath(token, "11111111-1111-4111-8111-111111111111")).toBe(
      `/api/share/${token}/cv/11111111-1111-4111-8111-111111111111`,
    );
  });
});

describe("isShareUrl", () => {
  it("accepts the link the site made", () => {
    expect(isShareUrl(`https://vivier.app/share/${token}`, "https://vivier.app")).toBe(true);
  });

  it("refuses another origin, a query, a hash, another path or a bad token", () => {
    expect(isShareUrl(`https://evil.example/share/${token}`, "https://vivier.app")).toBe(false);
    expect(isShareUrl(`https://vivier.app/share/${token}?x=1`, "https://vivier.app")).toBe(false);
    expect(isShareUrl(`https://vivier.app/share/${token}#x`, "https://vivier.app")).toBe(false);
    expect(isShareUrl(`https://vivier.app/invite/${token}`, "https://vivier.app")).toBe(false);
    expect(isShareUrl("https://vivier.app/share/short", "https://vivier.app")).toBe(false);
    expect(isShareUrl("not a url", "https://vivier.app")).toBe(false);
    expect(isShareUrl(`https://vivier.app/share/${token}`, null)).toBe(false);
  });
});
