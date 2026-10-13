import { describe, expect, it } from "vitest";

import { acceptErrorKey } from "./accept-error";

describe("acceptErrorKey", () => {
  it("maps each refusal of accept_invitation() to its sentence", () => {
    expect(acceptErrorKey("INVITE:not_found")).toBe("invite.notFound");
    expect(acceptErrorKey("P0001: INVITE:used")).toBe("invite.used");
    expect(acceptErrorKey("INVITE:expired")).toBe("invite.expired");
    expect(acceptErrorKey("INVITE:email_mismatch")).toBe("invite.emailMismatch");
  });

  it("answers the generic sentence for anything else", () => {
    expect(acceptErrorKey("network down")).toBe("invite.error");
    expect(acceptErrorKey(null)).toBe("invite.error");
    expect(acceptErrorKey(undefined)).toBe("invite.error");
  });
});
