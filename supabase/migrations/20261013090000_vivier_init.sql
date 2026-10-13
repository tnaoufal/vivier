-- Vivier: the collaborative talent pool. One schema, one migration for the
-- foundation. Every row belongs to an organisation; access is decided by
-- the caller's membership (memberships.role) through the helpers below,
-- never by anything the browser sends. The service role (the Worker's
-- server functions and the processor on Railway) bypasses RLS and is the
-- only writer of the columns a person must not set: processing results,
-- share tokens, email sends, plans.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- unaccent() is STABLE; a generated column needs an IMMUTABLE wrapper. The
-- dictionary of the extension does not change under us.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = extensions, public
AS $$
  SELECT extensions.unaccent('extensions.unaccent', p_text);
$$;

-- ---------------------------------------------------------------------
-- profiles: one per auth user, created by trigger
-- ---------------------------------------------------------------------

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- The profile follows the account: a changed email is mirrored.
CREATE OR REPLACE FUNCTION public.handle_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id AND email IS DISTINCT FROM NEW.email;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_user_updated() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_updated();

-- ---------------------------------------------------------------------
-- organisations and memberships
-- ---------------------------------------------------------------------

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$'),
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  -- GDPR: how long a candidate is kept after the last contact (CNIL: two years at most).
  retention_months INTEGER NOT NULL DEFAULT 24 CHECK (retention_months BETWEEN 1 AND 24),
  -- Plans are set by billing only (sync_plan_from_billing), never by the browser.
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'team', 'business')),
  seat_limit INTEGER NOT NULL DEFAULT 3 CHECK (seat_limit BETWEEN 1 AND 1000),
  cv_quota_month INTEGER NOT NULL DEFAULT 200 CHECK (cv_quota_month BETWEEN 0 AND 1000000),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.memberships (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX memberships_user_idx ON public.memberships (user_id);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- The caller's role in an organisation, or null. SECURITY DEFINER so the
-- policies on memberships itself never recurse.
CREATE OR REPLACE FUNCTION public.org_role(p_org UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role FROM public.memberships m WHERE m.org_id = p_org AND m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.role_rank(p_role TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'member' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.org_role(p_org) IS NOT NULL;
$$;

-- True when the caller holds at least p_min in the organisation.
CREATE OR REPLACE FUNCTION public.has_org_role(p_org UUID, p_min TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.role_rank(public.org_role(p_org)) >= public.role_rank(p_min);
$$;

GRANT EXECUTE ON FUNCTION public.org_role(UUID), public.is_org_member(UUID), public.has_org_role(UUID, TEXT), public.role_rank(TEXT) TO authenticated, service_role;

-- profiles: a person reads their own profile and the profiles of the people
-- they share an organisation with (names next to comments and votes).
CREATE POLICY "profiles: own and co-members" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships mine
      JOIN public.memberships theirs ON theirs.org_id = mine.org_id
      WHERE mine.user_id = auth.uid() AND theirs.user_id = public.profiles.id
    )
  );

CREATE POLICY "profiles: update own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

GRANT SELECT, UPDATE (display_name, locale) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- organizations
CREATE POLICY "organizations: members read" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "organizations: admins update" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.has_org_role(id, 'admin'))
  WITH CHECK (public.has_org_role(id, 'admin'));

CREATE POLICY "organizations: owners delete" ON public.organizations
  FOR DELETE TO authenticated
  USING (public.has_org_role(id, 'owner'));

GRANT SELECT, DELETE ON public.organizations TO authenticated;
GRANT UPDATE (name, locale, retention_months) ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

-- memberships
CREATE POLICY "memberships: members read" ON public.memberships
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- Admins manage members below owner; an owner manages everyone but cannot
-- remove the last owner (enforced by the trigger below).
CREATE POLICY "memberships: admins update" ON public.memberships
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, 'admin') AND role <> 'owner' OR public.has_org_role(org_id, 'owner'))
  WITH CHECK (
    (public.has_org_role(org_id, 'owner'))
    OR (public.has_org_role(org_id, 'admin') AND role IN ('admin', 'member', 'viewer'))
  );

CREATE POLICY "memberships: admins remove, anyone leaves" ON public.memberships
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_org_role(org_id, 'owner')
    OR (public.has_org_role(org_id, 'admin') AND role <> 'owner')
  );

GRANT SELECT, UPDATE (role), DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;

CREATE OR REPLACE FUNCTION public.keep_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID := COALESCE(OLD.org_id, NEW.org_id);
  v_owners INTEGER;
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN
    SELECT count(*) INTO v_owners FROM public.memberships
      WHERE org_id = v_org AND role = 'owner' AND user_id <> OLD.user_id;
    IF OLD.role = 'owner' AND v_owners = 0 AND EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
      RAISE EXCEPTION 'ORG:last_owner' USING HINT = 'Transfer ownership before leaving.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_keep_last_owner
  BEFORE UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.keep_last_owner();

-- Creates an organisation with the caller as owner. The only way a person
-- creates one: a direct insert is not granted.
CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT, p_slug TEXT, p_locale TEXT DEFAULT 'fr')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH:required'; END IF;
  IF p_locale NOT IN ('fr', 'en') THEN p_locale := 'fr'; END IF;
  INSERT INTO public.organizations (name, slug, locale, created_by)
    VALUES (btrim(p_name), lower(p_slug), p_locale, auth.uid())
    RETURNING id INTO v_id;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_id, auth.uid(), 'owner');
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

-- Seats: the plan's limit counts members plus pending invitations.
CREATE OR REPLACE FUNCTION public.seats_used(p_org UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*) FROM public.memberships WHERE org_id = p_org)::INTEGER
       + (SELECT count(*) FROM public.invitations WHERE org_id = p_org AND accepted_at IS NULL AND expires_at > now())::INTEGER;
$$;

-- ---------------------------------------------------------------------
-- invitations: by email, token hashed at rest
-- ---------------------------------------------------------------------

CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invitations_org_idx ON public.invitations (org_id, created_at DESC);
CREATE UNIQUE INDEX invitations_pending_email_idx ON public.invitations (org_id, lower(email)) WHERE accepted_at IS NULL;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations: admins read" ON public.invitations
  FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, 'admin'));

CREATE POLICY "invitations: admins revoke" ON public.invitations
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, 'admin'));

GRANT SELECT (id, org_id, email, role, invited_by, expires_at, accepted_at, created_at), DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;

GRANT EXECUTE ON FUNCTION public.seats_used(UUID) TO authenticated, service_role;

-- The invited person accepts with the raw token from their email; the row
-- holds its SHA-256 only. The invited address must match the account's.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH:required'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT * INTO v_inv FROM public.invitations
    WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVITE:not_found'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'INVITE:used'; END IF;
  IF v_inv.expires_at < now() THEN RAISE EXCEPTION 'INVITE:expired'; END IF;
  IF lower(v_inv.email) <> lower(COALESCE(v_email, '')) THEN RAISE EXCEPTION 'INVITE:email_mismatch'; END IF;
  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_inv.org_id, auth.uid(), v_inv.role)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  UPDATE public.invitations SET accepted_at = now(), accepted_by = auth.uid() WHERE id = v_inv.id;
  RETURN v_inv.org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- candidates and documents
-- ---------------------------------------------------------------------

CREATE TABLE public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  -- Current or most recent title, e.g. "Contrôleur de gestion senior".
  headline TEXT,
  location TEXT,
  years_experience NUMERIC(4, 1) CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70),
  availability TEXT,
  summary TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  -- [{ "name": "Anglais", "level": "C1" }]
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "title", "company", "start", "end", "description" }]
  experiences JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "degree", "school", "year" }]
  education JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "label", "url" }]
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  -- Per field, 0..1: what the structuring read with certainty. A missing
  -- key means the field was not read (never shown as a mismatch).
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Where the row came from: 'upload' (a CV), 'manual' (typed in).
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'manual')),
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown', 'given', 'withdrawn')),
  consent_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  -- Dedup key computed by the processor: the email, else name + phone.
  fingerprint TEXT,
  -- Everything the full-text index reads, built by the processor.
  search_text TEXT,
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', public.immutable_unaccent(coalesce(search_text, '')))) STORED,
  embedding extensions.vector(1024),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX candidates_org_idx ON public.candidates (org_id, status, updated_at DESC);
CREATE INDEX candidates_fts_idx ON public.candidates USING gin (fts);
CREATE INDEX candidates_fingerprint_idx ON public.candidates (org_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX candidates_skills_idx ON public.candidates USING gin (skills);
CREATE INDEX candidates_tags_idx ON public.candidates USING gin (tags);
CREATE INDEX candidates_name_trgm_idx ON public.candidates USING gin (public.immutable_unaccent(lower(coalesce(full_name, ''))) extensions.gin_trgm_ops);
-- HNSW works from the first row; cosine matches normalised embeddings.
CREATE INDEX candidates_embedding_idx ON public.candidates USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER candidates_set_updated_at BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "candidates: members read" ON public.candidates
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "candidates: members insert" ON public.candidates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, 'member') AND created_by = auth.uid());

CREATE POLICY "candidates: members update" ON public.candidates
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, 'member'))
  WITH CHECK (public.has_org_role(org_id, 'member'));

CREATE POLICY "candidates: admins delete" ON public.candidates
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, 'admin'));

GRANT SELECT, DELETE ON public.candidates TO authenticated;
GRANT INSERT (org_id, full_name, email, phone, headline, location, years_experience, availability, summary, skills, languages, experiences, education, links, tags, source, consent_status, consent_at, last_contact_at, created_by) ON public.candidates TO authenticated;
-- The browser corrects what it reads; the processor owns fingerprint,
-- search_text, embedding and confidence.
GRANT UPDATE (full_name, email, phone, headline, location, years_experience, availability, summary, skills, languages, experiences, education, links, tags, consent_status, consent_at, last_contact_at, status) ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  -- Object key in the private `cvs` bucket: <org_id>/<document_id>.pdf
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'needs_ocr', 'failed')),
  -- A sentence for the person when status is failed or needs_ocr; never a stack.
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  text_chars INTEGER,
  extracted_text TEXT,
  extraction_method TEXT CHECK (extraction_method IS NULL OR extraction_method IN ('pdf-text', 'ocr', 'none')),
  -- 'model' when a model structured the CV, 'heuristic' when only regexes did.
  structuring_method TEXT CHECK (structuring_method IS NULL OR structuring_method IN ('model', 'heuristic')),
  processed_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_org_idx ON public.documents (org_id, created_at DESC);
CREATE INDEX documents_candidate_idx ON public.documents (candidate_id);
CREATE INDEX documents_status_idx ON public.documents (status, updated_at) WHERE status IN ('queued', 'processing');
CREATE UNIQUE INDEX documents_org_sha_idx ON public.documents (org_id, sha256) WHERE sha256 IS NOT NULL;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "documents: members read" ON public.documents
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "documents: members insert" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_org_role(org_id, 'member')
    AND uploaded_by = auth.uid()
    AND storage_path LIKE org_id::text || '/%'
  );

CREATE POLICY "documents: members retry or attach" ON public.documents
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, 'member'))
  WITH CHECK (public.has_org_role(org_id, 'member'));

CREATE POLICY "documents: admins delete" ON public.documents
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, 'admin'));

GRANT SELECT, DELETE ON public.documents TO authenticated;
GRANT INSERT (id, org_id, candidate_id, storage_path, file_name, mime_type, byte_size, sha256, uploaded_by) ON public.documents TO authenticated;
-- A person may re-queue a failed document or attach it to a candidate; the
-- results are the processor's.
GRANT UPDATE (status, candidate_id) ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

-- The browser may only move a document back to the queue.
CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'authenticated' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'DOC:status_not_allowed';
    END IF;
    IF NEW.status = 'queued' AND OLD.status IN ('queued', 'processing') THEN
      RAISE EXCEPTION 'DOC:already_queued';
    END IF;
    IF NEW.status = 'queued' AND OLD.status <> 'queued' THEN
      NEW.error := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_guard_update BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_update();

-- ---------------------------------------------------------------------
-- briefs, searches
-- ---------------------------------------------------------------------

CREATE TABLE public.briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  -- [{ "id", "kind": "skill|experience|language|location|education|availability|other",
  --    "label", "value", "required": bool, "weight": 1..3 }]
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
  embedding extensions.vector(1024),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX briefs_org_idx ON public.briefs (org_id, status, updated_at DESC);

ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER briefs_set_updated_at BEFORE UPDATE ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "briefs: members read" ON public.briefs
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "briefs: members insert" ON public.briefs
  FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, 'member') AND created_by = auth.uid());
CREATE POLICY "briefs: members update" ON public.briefs
  FOR UPDATE TO authenticated USING (public.has_org_role(org_id, 'member')) WITH CHECK (public.has_org_role(org_id, 'member'));
CREATE POLICY "briefs: admins delete" ON public.briefs
  FOR DELETE TO authenticated USING (public.has_org_role(org_id, 'admin'));

GRANT SELECT, DELETE ON public.briefs TO authenticated;
GRANT INSERT (org_id, title, description, criteria, status, created_by) ON public.briefs TO authenticated;
GRANT UPDATE (title, description, criteria, status) ON public.briefs TO authenticated;
GRANT ALL ON public.briefs TO service_role;

CREATE TABLE public.searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brief_id UUID REFERENCES public.briefs(id) ON DELETE CASCADE,
  query TEXT NOT NULL DEFAULT '',
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "candidateId", "score", "coverage", "verdicts": [...], "why" }]
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_count INTEGER NOT NULL DEFAULT 0,
  -- 'hybrid' (text + vectors), 'text' (no embedding available).
  method TEXT NOT NULL DEFAULT 'text' CHECK (method IN ('hybrid', 'text')),
  ran_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX searches_brief_idx ON public.searches (brief_id, created_at DESC);

ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "searches: members read" ON public.searches
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "searches: members insert" ON public.searches
  FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, 'member') AND ran_by = auth.uid());

GRANT SELECT ON public.searches TO authenticated;
GRANT INSERT (org_id, brief_id, query, criteria, results, result_count, method, ran_by) ON public.searches TO authenticated;
GRANT ALL ON public.searches TO service_role;

-- Hybrid retrieval: full text (unaccented, simple dictionary so French and
-- English both work) fused with cosine similarity by reciprocal rank
-- fusion. SECURITY INVOKER: the caller's RLS decides what it sees. Scoring
-- against the brief's criteria happens in the application, where every
-- verdict is explained; this only ranks what to look at.
CREATE OR REPLACE FUNCTION public.search_candidates(
  p_org UUID,
  p_query TEXT,
  p_embedding extensions.vector(1024) DEFAULT NULL,
  p_limit INTEGER DEFAULT 60
)
RETURNS TABLE (candidate_id UUID, text_rank INTEGER, vector_rank INTEGER, score REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT CASE WHEN btrim(coalesce(p_query, '')) = '' THEN NULL
                ELSE websearch_to_tsquery('simple', public.immutable_unaccent(p_query)) END AS tsq
  ),
  by_text AS (
    SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.fts, q.tsq) DESC, c.updated_at DESC) AS r
    FROM public.candidates c, q
    WHERE c.org_id = p_org AND c.status = 'active' AND q.tsq IS NOT NULL AND c.fts @@ q.tsq
    LIMIT GREATEST(p_limit * 3, 60)
  ),
  by_vector AS (
    SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> p_embedding) AS r
    FROM public.candidates c
    WHERE c.org_id = p_org AND c.status = 'active' AND p_embedding IS NOT NULL AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_embedding
    LIMIT GREATEST(p_limit * 3, 60)
  ),
  fused AS (
    SELECT coalesce(t.id, v.id) AS id,
           t.r AS tr,
           v.r AS vr,
           coalesce(1.0 / (60 + t.r), 0) + coalesce(1.0 / (60 + v.r), 0) AS s
    FROM by_text t FULL OUTER JOIN by_vector v ON v.id = t.id
  )
  SELECT id, tr::INTEGER, vr::INTEGER, s::REAL FROM fused ORDER BY s DESC LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

GRANT EXECUTE ON FUNCTION public.search_candidates(UUID, TEXT, extensions.vector, INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- shortlists: one per brief, worked by the whole team
-- ---------------------------------------------------------------------

CREATE TABLE public.shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brief_id UUID NOT NULL UNIQUE REFERENCES public.briefs(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shortlists ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER shortlists_set_updated_at BEFORE UPDATE ON public.shortlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "shortlists: members read" ON public.shortlists
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "shortlists: members insert" ON public.shortlists
  FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, 'member') AND created_by = auth.uid());

GRANT SELECT ON public.shortlists TO authenticated;
GRANT INSERT (org_id, brief_id, created_by) ON public.shortlists TO authenticated;
GRANT ALL ON public.shortlists TO service_role;

CREATE TABLE public.shortlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shortlist_id UUID NOT NULL REFERENCES public.shortlists(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  -- Every decision is a person's: the model never sets this.
  status TEXT NOT NULL DEFAULT 'to_review' CHECK (status IN ('to_review', 'retained', 'dismissed')),
  position INTEGER NOT NULL DEFAULT 0,
  -- The explained match at the time the candidate was added (searches.results[]).
  match JSONB,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 4000),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shortlist_id, candidate_id)
);

CREATE INDEX shortlist_items_list_idx ON public.shortlist_items (shortlist_id, status, position);

ALTER TABLE public.shortlist_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER shortlist_items_set_updated_at BEFORE UPDATE ON public.shortlist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Who decided is recorded by the database, not trusted from the browser.
CREATE OR REPLACE FUNCTION public.stamp_shortlist_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.decided_by := auth.uid();
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shortlist_items_stamp_decision BEFORE UPDATE ON public.shortlist_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_shortlist_decision();

CREATE POLICY "shortlist_items: members read" ON public.shortlist_items
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "shortlist_items: members insert" ON public.shortlist_items
  FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, 'member') AND added_by = auth.uid());
CREATE POLICY "shortlist_items: members update" ON public.shortlist_items
  FOR UPDATE TO authenticated USING (public.has_org_role(org_id, 'member')) WITH CHECK (public.has_org_role(org_id, 'member'));
CREATE POLICY "shortlist_items: members delete" ON public.shortlist_items
  FOR DELETE TO authenticated USING (public.has_org_role(org_id, 'member'));

GRANT SELECT, DELETE ON public.shortlist_items TO authenticated;
GRANT INSERT (org_id, shortlist_id, candidate_id, status, position, match, note, assigned_to, added_by) ON public.shortlist_items TO authenticated;
GRANT UPDATE (status, position, note, assigned_to) ON public.shortlist_items TO authenticated;
GRANT ALL ON public.shortlist_items TO service_role;

CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shortlist_item_id UUID REFERENCES public.shortlist_items(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  brief_id UUID REFERENCES public.briefs(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  mentions UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (shortlist_item_id IS NOT NULL OR candidate_id IS NOT NULL OR brief_id IS NOT NULL)
);

CREATE INDEX comments_item_idx ON public.comments (shortlist_item_id, created_at);
CREATE INDEX comments_candidate_idx ON public.comments (candidate_id, created_at);
CREATE INDEX comments_brief_idx ON public.comments (brief_id, created_at);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "comments: members read" ON public.comments
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "comments: members write" ON public.comments
  FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, 'member') AND author_id = auth.uid());
CREATE POLICY "comments: author edits" ON public.comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments: author or admin deletes" ON public.comments
  FOR DELETE TO authenticated USING (author_id = auth.uid() OR public.has_org_role(org_id, 'admin'));

GRANT SELECT, DELETE ON public.comments TO authenticated;
GRANT INSERT (org_id, shortlist_item_id, candidate_id, brief_id, author_id, body, mentions) ON public.comments TO authenticated;
GRANT UPDATE (body, mentions) ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;

CREATE TABLE public.votes (
  shortlist_item_id UUID NOT NULL REFERENCES public.shortlist_items(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shortlist_item_id, user_id)
);

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "votes: members read" ON public.votes
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "votes: own vote" ON public.votes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.has_org_role(org_id, 'member'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.votes TO authenticated;
GRANT ALL ON public.votes TO service_role;

-- ---------------------------------------------------------------------
-- activities: the audit log, written by triggers, read by members
-- ---------------------------------------------------------------------

CREATE TABLE public.activities (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  brief_id UUID,
  candidate_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activities_org_idx ON public.activities (org_id, created_at DESC);
CREATE INDEX activities_brief_idx ON public.activities (brief_id, created_at DESC) WHERE brief_id IS NOT NULL;
CREATE INDEX activities_candidate_idx ON public.activities (candidate_id, created_at DESC) WHERE candidate_id IS NOT NULL;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities: members read" ON public.activities
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

GRANT SELECT ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;
GRANT USAGE ON SEQUENCE public.activities_id_seq TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_activity(
  p_org UUID, p_kind TEXT, p_target_type TEXT, p_target_id UUID,
  p_brief UUID, p_candidate UUID, p_payload JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.activities (org_id, actor_id, kind, target_type, target_id, brief_id, candidate_id, payload)
  VALUES (p_org, auth.uid(), p_kind, p_target_type, p_target_id, p_brief, p_candidate, coalesce(p_payload, '{}'::jsonb));
$$;

REVOKE EXECUTE ON FUNCTION public.log_activity(UUID, TEXT, TEXT, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_shortlist_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brief UUID;
BEGIN
  SELECT brief_id INTO v_brief FROM public.shortlists WHERE id = COALESCE(NEW.shortlist_id, OLD.shortlist_id);
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.org_id, 'shortlist.added', 'shortlist_item', NEW.id, v_brief, NEW.candidate_id, '{}'::jsonb);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(OLD.org_id, 'shortlist.removed', 'shortlist_item', OLD.id, v_brief, OLD.candidate_id, '{}'::jsonb);
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_activity(NEW.org_id, 'shortlist.status', 'shortlist_item', NEW.id, v_brief, NEW.candidate_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    PERFORM public.log_activity(NEW.org_id, 'shortlist.assigned', 'shortlist_item', NEW.id, v_brief, NEW.candidate_id,
      jsonb_build_object('to', NEW.assigned_to));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shortlist_items_track AFTER INSERT OR UPDATE OR DELETE ON public.shortlist_items
  FOR EACH ROW EXECUTE FUNCTION public.track_shortlist_items();

CREATE OR REPLACE FUNCTION public.track_comments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brief UUID := NEW.brief_id;
  v_candidate UUID := NEW.candidate_id;
BEGIN
  IF NEW.shortlist_item_id IS NOT NULL THEN
    SELECT s.brief_id, i.candidate_id INTO v_brief, v_candidate
      FROM public.shortlist_items i JOIN public.shortlists s ON s.id = i.shortlist_id
      WHERE i.id = NEW.shortlist_item_id;
  END IF;
  PERFORM public.log_activity(NEW.org_id, 'comment.added', 'comment', NEW.id, v_brief, v_candidate,
    jsonb_build_object('mentions', to_jsonb(NEW.mentions)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER comments_track AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.track_comments();

CREATE OR REPLACE FUNCTION public.track_briefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.org_id, 'brief.created', 'brief', NEW.id, NEW.id, NULL, jsonb_build_object('title', NEW.title));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_activity(NEW.org_id, 'brief.status', 'brief', NEW.id, NEW.id, NULL, jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER briefs_track AFTER INSERT OR UPDATE ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION public.track_briefs();

CREATE OR REPLACE FUNCTION public.track_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.org_id, 'document.uploaded', 'document', NEW.id, NULL, NEW.candidate_id, jsonb_build_object('fileName', NEW.file_name));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('processed', 'failed', 'needs_ocr') THEN
    PERFORM public.log_activity(NEW.org_id, 'document.' || NEW.status, 'document', NEW.id, NULL, NEW.candidate_id,
      jsonb_build_object('fileName', NEW.file_name, 'method', NEW.structuring_method));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_track AFTER INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.track_documents();

CREATE OR REPLACE FUNCTION public.track_candidates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(OLD.org_id, 'candidate.deleted', 'candidate', OLD.id, NULL, NULL, jsonb_build_object('name', OLD.full_name));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.log_activity(NEW.org_id, 'candidate.' || NEW.status, 'candidate', NEW.id, NULL, NEW.id, '{}'::jsonb);
    END IF;
    IF NEW.consent_status IS DISTINCT FROM OLD.consent_status THEN
      PERFORM public.log_activity(NEW.org_id, 'candidate.consent', 'candidate', NEW.id, NULL, NEW.id, jsonb_build_object('to', NEW.consent_status));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidates_track AFTER UPDATE OR DELETE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.track_candidates();

-- ---------------------------------------------------------------------
-- shares and email sends: written by the server only
-- ---------------------------------------------------------------------

CREATE TABLE public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shortlist_id UUID NOT NULL REFERENCES public.shortlists(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  intro TEXT NOT NULL DEFAULT '' CHECK (char_length(intro) <= 8000),
  -- Snapshot of what was shared: [{ "candidateId", "name", "headline", "summary",
  --   "strengths": [], "attention": [], "documentId" }]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  include_cvs BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shares_shortlist_idx ON public.shares (shortlist_id, created_at DESC);

ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shares: members read" ON public.shares
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

GRANT SELECT (id, org_id, shortlist_id, title, intro, items, include_cvs, expires_at, revoked_at, view_count, last_viewed_at, created_by, created_at) ON public.shares TO authenticated;
GRANT ALL ON public.shares TO service_role;

CREATE TABLE public.email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('share', 'invitation')),
  share_id UUID REFERENCES public.shares(id) ON DELETE SET NULL,
  invitation_id UUID REFERENCES public.invitations(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_sends_org_idx ON public.email_sends (org_id, created_at DESC);
CREATE INDEX email_sends_share_idx ON public.email_sends (share_id);

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sends: members read" ON public.email_sends
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

GRANT SELECT ON public.email_sends TO authenticated;
GRANT ALL ON public.email_sends TO service_role;

-- ---------------------------------------------------------------------
-- model usage: what the deployment spent, per organisation
-- ---------------------------------------------------------------------

CREATE TABLE public.ai_usage (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('structure', 'embed', 'ocr', 'brief', 'explain', 'summary')),
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_org_idx ON public.ai_usage (org_id, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage: admins read" ON public.ai_usage
  FOR SELECT TO authenticated USING (public.has_org_role(org_id, 'admin'));

GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

-- CVs processed this calendar month, against organizations.cv_quota_month.
CREATE OR REPLACE FUNCTION public.cvs_processed_this_month(p_org UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::INTEGER FROM public.documents
  WHERE org_id = p_org AND processed_at >= date_trunc('month', now());
$$;

GRANT EXECUTE ON FUNCTION public.cvs_processed_this_month(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- retention (GDPR): what is due for deletion, decided per organisation
-- ---------------------------------------------------------------------

-- Candidates past the organisation's retention, counted from the last
-- contact (or the upload). The processor deletes their files, then calls
-- purge_candidate(); a withdrawn consent is due at once.
CREATE OR REPLACE FUNCTION public.expired_candidates(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (candidate_id UUID, org_id UUID, reason TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id,
         CASE WHEN c.consent_status = 'withdrawn' THEN 'consent_withdrawn' ELSE 'retention' END
  FROM public.candidates c
  JOIN public.organizations o ON o.id = c.org_id
  WHERE c.consent_status = 'withdrawn'
     OR coalesce(c.last_contact_at, c.created_at) + make_interval(months => o.retention_months) < now()
  ORDER BY c.created_at
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.expired_candidates(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expired_candidates(INTEGER) TO service_role;

-- When the candidate would be deleted, for the UI.
CREATE OR REPLACE FUNCTION public.retention_due_at(p_candidate UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(c.last_contact_at, c.created_at) + make_interval(months => o.retention_months)
  FROM public.candidates c JOIN public.organizations o ON o.id = c.org_id
  WHERE c.id = p_candidate;
$$;

GRANT EXECUTE ON FUNCTION public.retention_due_at(UUID) TO authenticated, service_role;

-- Plans are only ever set from billing (the webhook, verified), never by
-- a person. The seat and quota of each plan live here.
CREATE OR REPLACE FUNCTION public.sync_plan_from_billing(p_org UUID, p_plan TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.organizations SET
    plan = p_plan,
    seat_limit = CASE p_plan WHEN 'business' THEN 50 WHEN 'team' THEN 10 ELSE 3 END,
    cv_quota_month = CASE p_plan WHEN 'business' THEN 5000 WHEN 'team' THEN 1000 ELSE 200 END
  WHERE id = p_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_plan_from_billing(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_plan_from_billing(UUID, TEXT) TO service_role;

-- A person deletes their own account; organisations they own alone go
-- with it (the last-owner guard is bypassed by deleting the organisation).
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH:required'; END IF;
  DELETE FROM public.organizations o
    WHERE EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = o.id AND m.user_id = v_uid AND m.role = 'owner')
      AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = o.id AND m.user_id <> v_uid AND m.role = 'owner');
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- ---------------------------------------------------------------------
-- storage: the private `cvs` bucket, one folder per organisation
-- ---------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cvs', 'cvs', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "cvs: members read their organisation's files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cvs' AND public.is_org_member(((storage.foldername(name))[1])::uuid));

CREATE POLICY "cvs: members upload into their organisation's folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cvs' AND public.has_org_role(((storage.foldername(name))[1])::uuid, 'member'));

CREATE POLICY "cvs: admins delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cvs' AND public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin'));

-- ---------------------------------------------------------------------
-- realtime: the collaborative tables
-- ---------------------------------------------------------------------

ALTER TABLE public.shortlist_items REPLICA IDENTITY FULL;
ALTER TABLE public.comments REPLICA IDENTITY FULL;
ALTER TABLE public.votes REPLICA IDENTITY FULL;
ALTER TABLE public.documents REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shortlist_items, public.comments, public.votes, public.documents, public.activities;
  END IF;
END;
$$;

-- No table is reachable by the anonymous role.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
