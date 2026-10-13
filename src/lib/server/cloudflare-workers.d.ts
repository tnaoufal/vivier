/**
 * Minimal ambient typing for the `cloudflare:workers` module, scoped to
 * what rate-limit.server.ts uses. Not the full `@cloudflare/workers-types`
 * package, which redefines global Request/Response/fetch and would collide
 * with the DOM lib project-wide.
 */
declare module "cloudflare:workers" {
  export const env: {
    /** Rate-limit binding declared in wrangler.jsonc (see rate-limit.server.ts). */
    VIVIER_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
  } & Record<string, unknown>;
}
