/**
 * Per-client throttle on the server functions that cost something: model
 * calls, emails, share links, processor pokes. Inside Cloudflare Workers
 * the VIVIER_RATE_LIMITER binding (wrangler.jsonc) counts per data
 * centre; elsewhere an in-memory sliding window per process applies the
 * same policy. VIVIER_RATE_LIMIT=off disables the check.
 *
 * The client is keyed by address (an IPv6 address by its /64) and, when
 * the caller is known, by user id as a second bucket.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";

export type RateLimitScope =
  | "model"
  | "email"
  | "share"
  | "processor"
  | "search"
  | "assess"
  | "triage";

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitPolicy {
  limit: number;
  periodSeconds: number;
}

/** Mirrors the `simple` policy of the binding in wrangler.jsonc. */
export const RATE_LIMIT_POLICY: RateLimitPolicy = { limit: 60, periodSeconds: 60 };

export class RateLimitError extends Error {
  readonly scope: RateLimitScope;

  constructor(scope: RateLimitScope) {
    super("RATE:limited");
    this.name = "RateLimitError";
    this.scope = scope;
  }
}

const MEMORY_LIMITER_MAX_KEYS = 5_000;

/** Sliding window per key, per process. Good enough outside Workers. */
export class MemoryRateLimiter implements RateLimiterBinding {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const at = this.now();
    const cutoff = at - this.policy.periodSeconds * 1000;
    const recent = (this.hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (recent.length >= this.policy.limit) {
      this.hits.set(key, recent);
      return { success: false };
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > MEMORY_LIMITER_MAX_KEYS) this.prune(cutoff);
    return { success: true };
  }

  private prune(cutoff: number): void {
    for (const [key, stamps] of this.hits) {
      if (!stamps.some((stamp) => stamp > cutoff)) this.hits.delete(key);
    }
  }
}

/** An IPv4 address unchanged, an IPv6 address reduced to its /64 prefix. */
export function clientAddressKey(address: string): string {
  const raw = address.trim().toLowerCase();
  if (!raw.includes(":")) return raw;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped?.[1]) return mapped[1];
  const [head = "", tail] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=\w)/, "") || "0");
  return `${groups.join(":")}::/64`;
}

export interface HeaderReader {
  get(name: string): string | null | undefined;
}

/** The client's address from the request: Cloudflare's header first, else the forwarding chain. */
export function clientAddressOf(headers: HeaderReader): string | null {
  const get = (name: string) => headers.get(name);
  const direct = get("cf-connecting-ip");
  if (direct) return direct.trim();
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

const memoryLimiter = new MemoryRateLimiter(RATE_LIMIT_POLICY);

async function bindingLimiter(): Promise<RateLimiterBinding | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const binding = env["VIVIER_RATE_LIMITER"];
    return binding && typeof binding.limit === "function" ? binding : null;
  } catch {
    return null;
  }
}

/**
 * Throws RateLimitError when the client (or the user) exceeded the policy
 * in this scope. Outside a request (tests, internal calls) there is no
 * client to throttle: allowed.
 */
export async function enforceRateLimit(
  scope: RateLimitScope,
  options: { userKey?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (env["VIVIER_RATE_LIMIT"] === "off") return;
  let address: string | null = null;
  try {
    address = clientAddressOf(getRequestHeaders());
  } catch {
    return;
  }
  const limiter = (await bindingLimiter()) ?? memoryLimiter;
  const keys: string[] = [];
  if (address) keys.push(`${scope}:ip:${clientAddressKey(address)}`);
  if (options.userKey) keys.push(`${scope}:user:${options.userKey}`);
  if (!keys.length) {
    // Inside Workers every request carries an address; none means refuse.
    if (await bindingLimiter()) throw new RateLimitError(scope);
    return;
  }
  for (const key of keys) {
    const { success } = await limiter.limit({ key });
    if (!success) throw new RateLimitError(scope);
  }
}
