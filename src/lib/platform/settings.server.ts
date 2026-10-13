/**
 * The deployment's settings, read from the Worker's environment (set in
 * the Cloudflare dashboard, never committed). Values are trimmed; an
 * empty value is null. `describeSetup()` is what /status shows: presence
 * only, never a value.
 */

export interface Settings {
  siteUrl: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  supabaseServiceKey: string | null;
  processorUrl: string | null;
  processorSecret: string | null;
  llm: {
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
    embeddingModel: string | null;
    /** The chat model of the expert assessment when it differs from `model` (LLM_ASSESSMENT_MODEL); null means the same. */
    assessmentModel: string | null;
  };
  resend: { apiKey: string | null; from: string | null; replyTo: string | null };
  rateLimitOff: boolean;
}

function value(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Build-time values first (Vite defines them in the server bundle too), then the runtime env. */
function supabaseUrlOf(env: NodeJS.ProcessEnv): string | null {
  const built = (import.meta.env as Record<string, unknown>)["VITE_SUPABASE_URL"];
  return (typeof built === "string" && built) || value(env, "SUPABASE_URL");
}

function supabasePublishableKeyOf(env: NodeJS.ProcessEnv): string | null {
  const built = (import.meta.env as Record<string, unknown>)["VITE_SUPABASE_PUBLISHABLE_KEY"];
  return (typeof built === "string" && built) || value(env, "SUPABASE_PUBLISHABLE_KEY");
}

export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    siteUrl: value(env, "SITE_URL"),
    supabaseUrl: supabaseUrlOf(env),
    supabasePublishableKey: supabasePublishableKeyOf(env),
    supabaseServiceKey: value(env, "SUPABASE_SERVICE_ROLE_KEY"),
    processorUrl: value(env, "PROCESSOR_URL"),
    processorSecret: value(env, "PROCESSOR_SHARED_SECRET"),
    llm: {
      baseUrl: value(env, "LLM_BASE_URL"),
      apiKey: value(env, "LLM_API_KEY"),
      model: value(env, "LLM_MODEL"),
      embeddingModel: value(env, "LLM_EMBEDDING_MODEL"),
      assessmentModel: value(env, "LLM_ASSESSMENT_MODEL"),
    },
    resend: {
      apiKey: value(env, "RESEND_API_KEY"),
      from: value(env, "EMAIL_FROM"),
      replyTo: value(env, "EMAIL_REPLY_TO"),
    },
    rateLimitOff: value(env, "VIVIER_RATE_LIMIT") === "off",
  };
}

export interface Setup {
  site: boolean;
  accounts: boolean;
  serviceKey: boolean;
  processor: boolean;
  model: {
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    embeddingModel: string | null;
    /** The assessment's own model when one is named; null when the chat model assesses too. */
    assessmentModel: string | null;
  };
  email: boolean;
  rateLimit: boolean;
}

/** Presence of each part, for /status. The model's base URL and names are not secrets. */
export function describeSetup(env: NodeJS.ProcessEnv = process.env): Setup {
  const s = settings(env);
  return {
    site: Boolean(s.siteUrl),
    accounts: Boolean(s.supabaseUrl && s.supabasePublishableKey),
    serviceKey: Boolean(s.supabaseServiceKey),
    processor: Boolean(s.processorUrl && s.processorSecret),
    model: {
      configured: Boolean(s.llm.apiKey),
      baseUrl: s.llm.apiKey ? (s.llm.baseUrl ?? "https://api.openai.com/v1") : null,
      model: s.llm.apiKey ? (s.llm.model ?? "default") : null,
      embeddingModel: s.llm.apiKey ? (s.llm.embeddingModel ?? "default") : null,
      assessmentModel: s.llm.apiKey ? s.llm.assessmentModel : null,
    },
    // What emailSetup() decides: a key and the site origin the links are built on.
    email: Boolean(s.resend.apiKey && siteOriginOf(s.siteUrl)),
    rateLimit: !s.rateLimitOff,
  };
}

/** The site's origin for links in emails: SITE_URL only, never the request's. */
export function siteOriginOf(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
