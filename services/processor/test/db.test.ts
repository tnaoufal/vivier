import { describe, expect, it } from "vitest";

import { likeLiteral } from "../src/db.js";

describe("likeLiteral", () => {
  it("escapes the LIKE wildcards and the escape character, leaves the rest", () => {
    expect(likeLiteral("jean_pierre@example.com")).toBe("jean\\_pierre@example.com");
    expect(likeLiteral("100%")).toBe("100\\%");
    expect(likeLiteral("a\\b")).toBe("a\\\\b");
    expect(likeLiteral("marie.dupont@example.com")).toBe("marie.dupont@example.com");
    expect(likeLiteral("612345678")).toBe("612345678");
  });
});
