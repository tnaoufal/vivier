import { describe, expect, it } from "vitest";

import { emailLayout, escapeHtml, resendSender } from "./email.server";

describe("resendSender", () => {
  it("posts with the idempotency key and treats 409 as already sent", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = resendSender({
      apiKey: "k",
      from: "Vivier <hello@vivier.app>",
      replyTo: null,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return calls.length === 1
          ? new Response(JSON.stringify({ id: "re_1" }), { status: 200 })
          : new Response("", { status: 409 });
      }) as typeof fetch,
    });
    const first = await sender.send({ id: "row-1", to: "a@x.fr", subject: "s", html: "<p>h</p>", text: "t" });
    expect(first.id).toBe("re_1");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("row-1");
    expect(headers["Authorization"]).toBe("Bearer k");
    const again = await sender.send({ id: "row-1", to: "a@x.fr", subject: "s", html: "<p>h</p>", text: "t" });
    expect(again.id).toBe("");
  });
});

describe("emailLayout", () => {
  it("escapes what it is given and writes a text twin", () => {
    const { html, text } = emailLayout({
      title: "Hello <b>",
      paragraphs: ["A & B"],
      button: { label: "Open", url: "https://x.example/?a=1&b=2" },
      footer: "f",
    });
    expect(html).toContain("Hello &lt;b&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("https://x.example/?a=1&amp;b=2");
    expect(text).toContain("Open: https://x.example/?a=1&b=2");
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});
