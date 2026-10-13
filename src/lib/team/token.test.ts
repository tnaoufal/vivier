import { describe, expect, it } from "vitest";

import { base64url, isTokenShaped, randomToken, sha256Hex } from "./token";

describe("base64url", () => {
  it("encodes without padding and with the URL alphabet", () => {
    expect(base64url(new Uint8Array([]))).toBe("");
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(base64url(new Uint8Array([104, 105]))).toBe("aGk");
    expect(base64url(new Uint8Array([104, 105, 33]))).toBe("aGkh");
  });
});

describe("randomToken", () => {
  it("answers 43 URL-safe characters for 32 bytes and never the same twice", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toHaveLength(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(isTokenShaped(a)).toBe(true);
  });

  it("refuses token shapes that could not come from a link", () => {
    expect(isTokenShaped("short")).toBe(false);
    expect(isTokenShaped("has spaces and more than sixteen chars")).toBe(false);
    expect(isTokenShaped("x".repeat(129))).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
