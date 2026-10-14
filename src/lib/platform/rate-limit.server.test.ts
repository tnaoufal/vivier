import { describe, expect, it } from "vitest";

import {
  MemoryRateLimiter,
  clientAddressKey,
  clientAddressOf,
  rateLimitKeys,
} from "./rate-limit.server";

describe("clientAddressKey", () => {
  it("keeps IPv4 and reduces IPv6 to its /64", () => {
    expect(clientAddressKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientAddressKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientAddressKey("2001:db8:0:1:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:0:1::/64");
    expect(clientAddressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("clientAddressOf", () => {
  it("prefers Cloudflare's header, then the first forwarded address", () => {
    expect(
      clientAddressOf(new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("1.2.3.4");
    expect(clientAddressOf(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe(
      "9.9.9.9",
    );
    expect(clientAddressOf(new Headers())).toBeNull();
  });
});

describe("MemoryRateLimiter", () => {
  it("allows the policy's count then refuses until the window slides", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter({ limit: 2, periodSeconds: 60 }, () => now);
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
    expect((await limiter.limit({ key: "a" })).success).toBe(false);
    expect((await limiter.limit({ key: "b" })).success).toBe(true);
    now = 61_000;
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
  });
});

describe("rateLimitKeys", () => {
  it("counts an authenticated analysis call per user only, so one office address is not shared", () => {
    expect(rateLimitKeys("triage", "203.0.113.9", "u1")).toEqual(["triage:user:u1"]);
    expect(rateLimitKeys("assess", "203.0.113.9", "u1")).toEqual(["assess:user:u1"]);
  });

  it("keeps the address's bucket for the other scopes and for a call without a user", () => {
    expect(rateLimitKeys("model", "203.0.113.9", "u1")).toEqual([
      "model:ip:203.0.113.9",
      "model:user:u1",
    ]);
    expect(rateLimitKeys("triage", "203.0.113.9")).toEqual(["triage:ip:203.0.113.9"]);
    expect(rateLimitKeys("share", null)).toEqual([]);
  });
});
