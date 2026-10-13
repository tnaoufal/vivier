/**
 * Server side of Supabase: a thin REST client with the service role key
 * (only this file and the processor hold it), token verification with
 * Auth, and the membership check every gated server function runs. The
 * service role bypasses RLS, so every function here states which
 * organisation it works on and checks the caller's role first.
 */
import type { OrgRole } from "@/lib/db/types";
import { roleAtLeast } from "@/lib/db/types";

import { AppError } from "./errors";
import { settings, type Settings } from "./settings.server";

export interface ServiceClient {
  /** Reads rows: `path` is the table with its PostgREST query string. */
  select<T>(path: string): Promise<T[]>;
  /** How many rows `path` matches (PostgREST's exact count), without reading them. */
  count(path: string): Promise<number>;
  /** Inserts rows and answers them (with their generated columns). */
  insert<T>(table: string, rows: Record<string, unknown>[]): Promise<T[]>;
  /** Inserts or replaces rows by primary key. */
  upsert(table: string, rows: Record<string, unknown>[]): Promise<void>;
  patch<T = unknown>(
    table: string,
    match: Record<string, string>,
    patch: Record<string, unknown>,
  ): Promise<T[]>;
  delete(table: string, match: Record<string, string>): Promise<void>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** A signed URL for a private object, valid `expiresIn` seconds. */
  signUrl(bucket: string, path: string, expiresIn: number): Promise<string>;
  /** Removes objects from a bucket; missing ones are not an error. */
  removeObjects(bucket: string, paths: string[]): Promise<void>;
}

export class SupabaseRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(method: string, status: number, code: string) {
    super(`Supabase ${method} answered ${status}${code ? ` (${code})` : ""}`);
    this.name = "SupabaseRequestError";
    this.status = status;
    this.code = code;
  }
}

export function serviceClient(input: { url: string; serviceKey: string }): ServiceClient {
  const base = input.url.replace(/\/+$/, "");
  const headers = {
    apikey: input.serviceKey,
    Authorization: `Bearer ${input.serviceKey}`,
    "Content-Type": "application/json",
  };
  const call = async (path: string, init: RequestInit & { prefer?: string }) => {
    const response = await fetch(`${base}/${path}`, {
      ...init,
      headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}) },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let code = "";
      try {
        const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
        if (typeof parsed.code === "string") code = parsed.code;
        // A RAISE EXCEPTION in a function arrives as its message ("ORG:last_owner").
        if (!code && typeof parsed.message === "string" && /^[A-Z]+:[a-z_]+$/.test(parsed.message)) {
          code = parsed.message;
        }
      } catch {
        // Not JSON: nothing to name.
      }
      console.warn(
        "[supabase]",
        JSON.stringify({
          event: "request_failed",
          method: init.method,
          path: path.split("?")[0],
          status: response.status,
          code,
          body: body.slice(0, 1000),
        }),
      );
      throw new SupabaseRequestError(init.method ?? "GET", response.status, code);
    }
    return response;
  };
  const matchQuery = (match: Record<string, string>) =>
    Object.entries(match)
      .map(([key, val]) => `${key}=eq.${encodeURIComponent(val)}`)
      .join("&");
  return {
    select: async <T>(path: string) => {
      const response = await call(`rest/v1/${path}`, { method: "GET" });
      return (await response.json()) as T[];
    },
    count: async (path) => {
      // A HEAD with limit=1 answers no row; the total sits in Content-Range ("0-0/42", "*/0" for none).
      const response = await call(`rest/v1/${path}${path.includes("?") ? "&" : "?"}limit=1`, {
        method: "HEAD",
        prefer: "count=exact",
      });
      const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1];
      if (total === undefined) throw new Error("Supabase answered no count");
      return Number(total);
    },
    insert: async <T>(table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return [];
      const response = await call(`rest/v1/${table}`, {
        method: "POST",
        body: JSON.stringify(rows),
        prefer: "return=representation",
      });
      return (await response.json()) as T[];
    },
    upsert: async (table, rows) => {
      if (!rows.length) return;
      await call(`rest/v1/${table}`, {
        method: "POST",
        body: JSON.stringify(rows),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    patch: async <T>(table: string, match: Record<string, string>, patch: Record<string, unknown>) => {
      const response = await call(`rest/v1/${table}?${matchQuery(match)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        prefer: "return=representation",
      });
      return (await response.json()) as T[];
    },
    delete: async (table, match) => {
      await call(`rest/v1/${table}?${matchQuery(match)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
    },
    rpc: async <T>(fn: string, args: Record<string, unknown>) => {
      const response = await call(`rest/v1/rpc/${fn}`, {
        method: "POST",
        body: JSON.stringify(args),
      });
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    },
    signUrl: async (bucket, path, expiresIn) => {
      const response = await call(
        `storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`,
        { method: "POST", body: JSON.stringify({ expiresIn }) },
      );
      const json = (await response.json()) as { signedURL?: unknown };
      if (typeof json.signedURL !== "string") throw new Error("Storage answered no signed URL");
      return `${base}/storage/v1${json.signedURL}`;
    },
    removeObjects: async (bucket, paths) => {
      if (!paths.length) return;
      await call(`storage/v1/object/${bucket}`, {
        method: "DELETE",
        body: JSON.stringify({ prefixes: paths }),
      });
    },
  };
}

/** The service client of this deployment, or a SETUP error. */
export function db(s: Settings = settings()): ServiceClient {
  if (!s.supabaseUrl || !s.supabaseServiceKey) throw new AppError("SETUP:service_key");
  return serviceClient({ url: s.supabaseUrl, serviceKey: s.supabaseServiceKey });
}

export interface VerifiedUser {
  id: string;
  /** Confirmed address only; null before confirmation. */
  email: string | null;
}

export async function verifyAccessToken(
  token: string,
  s: Pick<Settings, "supabaseUrl" | "supabasePublishableKey">,
): Promise<VerifiedUser | null> {
  if (!token || !s.supabaseUrl || !s.supabasePublishableKey) return null;
  const response = await fetch(`${s.supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: s.supabasePublishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as {
    id?: unknown;
    email?: unknown;
    email_confirmed_at?: unknown;
  };
  if (typeof user.id !== "string") return null;
  const confirmed =
    typeof user.email_confirmed_at === "string" && user.email_confirmed_at.length > 0;
  return { id: user.id, email: confirmed && typeof user.email === "string" ? user.email : null };
}

const TOKEN_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, { user: VerifiedUser | null; until: number }>();

/** When the JWT says it expires (ms), or null. Auth verified it; this only bounds the cache. */
export function jwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function remember<K, V extends { until: number }>(cache: Map<K, V>, key: K, value: V, max: number) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** The person behind a token, verified once and remembered a few minutes. */
export async function userOfToken(
  token: string | undefined,
  s: Settings = settings(),
): Promise<VerifiedUser | null> {
  if (!token) return null;
  const now = Date.now();
  const hit = tokenCache.get(token);
  if (hit && hit.until > now) return hit.user;
  const user = await verifyAccessToken(token, s);
  const expiry = jwtExpiryMs(token);
  const until = user ? Math.min(now + TOKEN_TTL_MS, expiry ?? Infinity) : now + 30_000;
  if (until > now) remember(tokenCache, token, { user, until }, TOKEN_CACHE_MAX);
  return user;
}

export interface Caller {
  userId: string;
  email: string | null;
}

/** The signed-in caller, or an AUTH error. */
export async function requireCaller(accessToken: string | undefined): Promise<Caller> {
  const s = settings();
  if (!s.supabaseUrl || !s.supabasePublishableKey) throw new AppError("AUTH:not_configured");
  const user = await userOfToken(accessToken, s);
  if (!user) throw new AppError("AUTH:required");
  return { userId: user.id, email: user.email };
}

export interface Member extends Caller {
  orgId: string;
  role: OrgRole;
}

interface MembershipLookup {
  role: OrgRole;
}

/**
 * The caller as a member of the organisation holding at least `min`, or
 * an ORG error. Read with the service role from memberships, never from
 * anything the browser sends besides the token.
 */
export async function requireMember(
  accessToken: string | undefined,
  orgId: string,
  min: OrgRole = "viewer",
): Promise<Member> {
  const caller = await requireCaller(accessToken);
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new AppError("INPUT:invalid");
  const rows = await db().select<MembershipLookup>(
    `memberships?select=role&org_id=eq.${encodeURIComponent(orgId)}&user_id=eq.${encodeURIComponent(caller.userId)}&limit=1`,
  );
  const role = rows[0]?.role;
  if (!role) throw new AppError("ORG:not_member");
  if (!roleAtLeast(role, min)) throw new AppError("ORG:forbidden");
  return { ...caller, orgId, role };
}
