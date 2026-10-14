-- Evolution 5: every active profile of the pool is read for a brief.
-- A search no longer reads only the profiles a retrieval ranked closest:
-- it snapshots the whole active pool into search_triage (one row per
-- candidate, verdict null until read), the model sorts every profile by
-- métier in batches (yes, close, no, unknown, with a short reason), and
-- only the ones it keeps (yes, close, unknown: a card too thin to judge
-- is read in full rather than dropped) enter the search's results for
-- the full reading, the second opinion and the tiering. The browser
-- drives the batches; the rows are written by the service role only.
-- A candidate erased or a search deleted takes its rows with it.

ALTER TABLE public.searches DROP CONSTRAINT IF EXISTS searches_method_check;
ALTER TABLE public.searches
  ADD CONSTRAINT searches_method_check CHECK (method = ANY (ARRAY['hybrid'::text, 'text'::text, 'triage'::text]));

ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_kind_check CHECK (kind = ANY (ARRAY['structure'::text, 'embed'::text, 'ocr'::text, 'brief'::text, 'explain'::text, 'summary'::text, 'assess'::text, 'triage'::text]));

-- What a list needs without reading the results: how many profiles were
-- read in full, how many match, how many are near. Kept by
-- merge_search_results on every write-back.
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS assessed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS match_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS near_count INTEGER NOT NULL DEFAULT 0;
UPDATE public.searches s SET
  assessed_count = (SELECT count(*) FROM jsonb_array_elements(s.results) e WHERE jsonb_typeof(e -> 'assessment') = 'object'),
  match_count = (SELECT count(*) FROM jsonb_array_elements(s.results) e WHERE e -> 'assessment' ->> 'decision' = 'fit'),
  near_count = (SELECT count(*) FROM jsonb_array_elements(s.results) e WHERE e -> 'assessment' ->> 'decision' = 'borderline');

CREATE TABLE IF NOT EXISTS public.search_triage (
  search_id UUID NOT NULL REFERENCES public.searches(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  verdict TEXT CHECK (verdict IS NULL OR verdict = ANY (ARRAY['yes'::text, 'close'::text, 'no'::text, 'unknown'::text])),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  model TEXT,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (search_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS search_triage_search_verdict_idx ON public.search_triage (search_id, verdict);
CREATE INDEX IF NOT EXISTS search_triage_candidate_idx ON public.search_triage (candidate_id);
CREATE INDEX IF NOT EXISTS search_triage_org_idx ON public.search_triage (org_id);

ALTER TABLE public.search_triage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_triage FROM anon, authenticated;
GRANT SELECT ON public.search_triage TO authenticated;
CREATE POLICY "search_triage: members read" ON public.search_triage
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- The pool snapshot: one row per active candidate, in one statement, and
-- the search's pool_size written from the same rows, so the count shown
-- and the profiles to read are the same set.
CREATE OR REPLACE FUNCTION public.start_triage(p_org UUID, p_search UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.searches WHERE id = p_search AND org_id = p_org) THEN
    RAISE EXCEPTION 'search not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.search_triage (search_id, org_id, candidate_id)
  SELECT p_search, p_org, c.id
  FROM public.candidates c
  WHERE c.org_id = p_org AND c.status = 'active'
  ON CONFLICT (search_id, candidate_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  UPDATE public.searches
  SET pool_size = (SELECT count(*) FROM public.search_triage WHERE search_id = p_search)
  WHERE id = p_search AND org_id = p_org;
  RETURN inserted;
END;
$$;

-- One batch of verdicts written in one statement: [{candidate_id, verdict, reason}].
-- The first verdict wins: a batch sent again, or by a second session on
-- the same search, never overwrites a profile already read.
CREATE OR REPLACE FUNCTION public.record_triage(p_org UUID, p_search UUID, p_model TEXT, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE public.search_triage t
  SET verdict = r.verdict,
      reason = left(r.reason, 300),
      model = p_model,
      read_at = now()
  FROM jsonb_to_recordset(p_rows) AS r(candidate_id UUID, verdict TEXT, reason TEXT)
  WHERE t.search_id = p_search
    AND t.org_id = p_org
    AND t.candidate_id = r.candidate_id
    AND t.verdict IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

-- The stages' write-back in one statement, so batches sent in parallel
-- add up: each entry of p_results replaces the entry of the same
-- candidateId, an entry the row lacks is appended; result_count and the
-- three summary counts follow.
CREATE OR REPLACE FUNCTION public.merge_search_results(p_org UUID, p_search UUID, p_results JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  merged JSONB;
BEGIN
  -- The row is locked first: under READ COMMITTED each statement below
  -- then reads the entries the previous writer committed.
  PERFORM 1 FROM public.searches WHERE id = p_search AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'search not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(jsonb_agg(entry ORDER BY position), '[]'::jsonb)
  INTO merged
  FROM (
    SELECT coalesce(n.value, o.value) AS entry, o.ordinality AS position
    FROM public.searches s
    CROSS JOIN LATERAL jsonb_array_elements(s.results) WITH ORDINALITY AS o(value, ordinality)
    LEFT JOIN LATERAL (
      SELECT x.value FROM jsonb_array_elements(p_results) AS x(value)
      WHERE x.value ->> 'candidateId' = o.value ->> 'candidateId'
      LIMIT 1
    ) n ON TRUE
    WHERE s.id = p_search AND s.org_id = p_org
    UNION ALL
    SELECT x.value, 1000000000 + x.ordinality
    FROM jsonb_array_elements(p_results) WITH ORDINALITY AS x(value, ordinality)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.searches s
      CROSS JOIN LATERAL jsonb_array_elements(s.results) AS e(value)
      WHERE s.id = p_search AND s.org_id = p_org
        AND e.value ->> 'candidateId' = x.value ->> 'candidateId'
    )
  ) rows;

  UPDATE public.searches
  SET results = merged,
      result_count = jsonb_array_length(merged),
      assessed_count = (SELECT count(*) FROM jsonb_array_elements(merged) e WHERE jsonb_typeof(e -> 'assessment') = 'object'),
      match_count = (SELECT count(*) FROM jsonb_array_elements(merged) e WHERE e -> 'assessment' ->> 'decision' = 'fit'),
      near_count = (SELECT count(*) FROM jsonb_array_elements(merged) e WHERE e -> 'assessment' ->> 'decision' = 'borderline')
  WHERE id = p_search AND org_id = p_org;
  RETURN jsonb_array_length(merged);
END;
$$;

REVOKE ALL ON FUNCTION public.start_triage(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_triage(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_search_results(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_triage(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_triage(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_search_results(UUID, UUID, JSONB) TO service_role;
