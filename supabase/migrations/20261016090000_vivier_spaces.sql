-- Vivier, evolution 7 part B: the spaces. A person working alone gets a
-- personal space in one click (organizations.kind = 'personal', named
-- after them); everyone else creates a team. The browser never writes
-- the kind: create_organization() sets it, and accept_invitation() turns
-- a personal space into a team the moment a colleague joins. No RLS
-- change: members already read every column of their organisation, and
-- the column-level update grants (name, locale, retention_months in the
-- init migration; show_photos in the photos migration) stay as they are,
-- kind not among them.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'personal'));

-- One signature only: PostgREST refuses an RPC that two candidates
-- answer, so the three-argument function leaves before the four-argument
-- one takes its place. The body is the init migration's, plus the kind.
DROP FUNCTION IF EXISTS public.create_organization(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT, p_slug TEXT, p_locale TEXT DEFAULT 'fr', p_kind TEXT DEFAULT 'team')
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
  IF p_kind IS NULL OR p_kind NOT IN ('team', 'personal') THEN p_kind := 'team'; END IF;
  INSERT INTO public.organizations (name, slug, locale, kind, created_by)
    VALUES (btrim(p_name), lower(p_slug), p_locale, p_kind, auth.uid())
    RETURNING id INTO v_id;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_id, auth.uid(), 'owner');
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- The acceptance of the init migration, plus one statement: a personal
-- space that now counts a second member is a team. Decided here, with
-- the membership and as the definer, never in the browser.
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
  UPDATE public.organizations SET kind = 'team'
    WHERE id = v_inv.org_id AND kind = 'personal'
      AND (SELECT count(*) FROM public.memberships m WHERE m.org_id = v_inv.org_id) > 1;
  INSERT INTO public.activities (org_id, actor_id, kind, target_type, target_id, payload)
    VALUES (v_inv.org_id, auth.uid(), 'member.joined', 'membership', auth.uid(), jsonb_build_object('role', v_inv.role));
  UPDATE public.invitations SET accepted_at = now(), accepted_by = auth.uid() WHERE id = v_inv.id;
  RETURN v_inv.org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;
