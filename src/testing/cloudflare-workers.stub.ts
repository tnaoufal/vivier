/**
 * Test-only stand-in for the `cloudflare:workers` built-in module, which
 * only exists inside an actual Cloudflare Workers runtime -- vitest runs
 * under plain Node, where importing it for real fails module resolution.
 * Aliased in vitest.config.ts so every test file gets this instead.
 *
 * `env` has no binding, matching what a real non-Cloudflare environment
 * (this test runner, or `bun run dev`) actually sees: the rate-limit binding
 * is genuinely absent outside a deployed Worker, and rate-limit.server.ts
 * then falls back to its in-memory limiter.
 */
export const env: Record<string, unknown> = {};
