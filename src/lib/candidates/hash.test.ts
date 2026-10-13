import { describe, expect, it } from "vitest";

import { hashFile, sha256Hex } from "./hash";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("sha256Hex", () => {
  it("hashes abc to the known digest", async () => {
    expect(await sha256Hex(await new Blob(["abc"]).arrayBuffer())).toBe(ABC);
  });

  it("hashes an empty buffer", async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("reads a file", async () => {
    expect(await hashFile(new Blob(["abc"], { type: "application/pdf" }))).toBe(ABC);
  });
});
