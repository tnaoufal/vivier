-- Evolution 6: similar profiles, seniority first. similar_candidates v2
-- answers the 50 nearest by the current measure (the meaning of the
-- career when both profiles carry a vector, else the words of the
-- headline and the skills), ordered by the distance between seniority
-- bands first (years_experience 0-2, 3-5, 6-9, 10-14, 15 and more; the
-- reference's band from its own years; a band unknown on either side
-- last), then by similarity, and carries each neighbour's years. The
-- same order is written in src/lib/candidates/similar.ts (orderSimilar)
-- and applied in the browser too, so the list reads the same whatever
-- version of this function the database runs.

-- The seniority band of a number of years: 0 to 4, null when not stated.
CREATE OR REPLACE FUNCTION public.seniority_band(p_years NUMERIC)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_years IS NULL THEN NULL
    WHEN p_years < 3 THEN 0
    WHEN p_years < 6 THEN 1
    WHEN p_years < 10 THEN 2
    WHEN p_years < 15 THEN 3
    ELSE 4
  END;
$$;

GRANT EXECUTE ON FUNCTION public.seniority_band(NUMERIC) TO authenticated, service_role;

-- The result gains a column, which CREATE OR REPLACE refuses on a
-- function that exists: dropped first, then created again with the same
-- signature, the same default and the same grants. SECURITY INVOKER as
-- before: the caller's RLS decides what it sees.
DROP FUNCTION IF EXISTS public.similar_candidates(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.similar_candidates(
  p_org UUID,
  p_candidate UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (candidate_id UUID, similarity REAL, method TEXT, years_experience NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_embedding extensions.vector(1024);
  v_terms TEXT;
  v_query tsquery;
  v_band INTEGER;
  v_limit INTEGER := LEAST(GREATEST(p_limit, 1), 50);
BEGIN
  SELECT c.embedding,
         public.immutable_unaccent(coalesce(c.headline, '') || ' ' || array_to_string(c.skills, ' ')),
         public.seniority_band(c.years_experience)
    INTO v_embedding, v_terms, v_band
    FROM public.candidates c
   WHERE c.id = p_candidate AND c.org_id = p_org;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_embedding IS NOT NULL THEN
    RETURN QUERY
      WITH nearest AS (
        SELECT c.id, (1 - (c.embedding <=> v_embedding))::REAL AS nearness, c.years_experience AS years
          FROM public.candidates c
         WHERE c.org_id = p_org AND c.status = 'active' AND c.id <> p_candidate AND c.embedding IS NOT NULL
         ORDER BY c.embedding <=> v_embedding
         LIMIT 50
      )
      SELECT n.id, n.nearness, 'embedding'::TEXT, n.years
        FROM nearest n
       ORDER BY abs(public.seniority_band(n.years) - v_band) NULLS LAST, n.nearness DESC, n.id
       LIMIT v_limit;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF btrim(coalesce(v_terms, '')) = '' THEN RETURN; END IF;
  -- Every word of the headline and skills, any of them matching (OR).
  v_query := websearch_to_tsquery('simple', regexp_replace(btrim(v_terms), '\s+', ' OR ', 'g'));
  RETURN QUERY
    WITH nearest AS (
      SELECT c.id,
             LEAST(1.0, ts_rank_cd(c.fts, v_query) / NULLIF((SELECT max(ts_rank_cd(x.fts, v_query)) FROM public.candidates x WHERE x.org_id = p_org AND x.fts @@ v_query), 0))::REAL AS nearness,
             c.years_experience AS years
        FROM public.candidates c
       WHERE c.org_id = p_org AND c.status = 'active' AND c.id <> p_candidate AND c.fts @@ v_query
       ORDER BY ts_rank_cd(c.fts, v_query) DESC
       LIMIT 50
    )
    SELECT n.id, n.nearness, 'skills'::TEXT, n.years
      FROM nearest n
     ORDER BY abs(public.seniority_band(n.years) - v_band) NULLS LAST, n.nearness DESC, n.id
     LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.similar_candidates(UUID, UUID, INTEGER) TO authenticated, service_role;
