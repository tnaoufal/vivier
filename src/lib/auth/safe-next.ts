/** Only a same-site path is followed after sign-in; anything else goes to the app. */
export function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)/.test(value) ? value : "/app";
}
