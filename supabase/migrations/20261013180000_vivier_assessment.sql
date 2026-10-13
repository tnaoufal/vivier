-- Evolution 2: documents that are not CVs are rejected (never structured),
-- similar candidates by meaning then by skills, and the activity log
-- learns the new document outcome. Search results carry the model's
-- requirement-by-requirement assessment as JSON (searches.results,
-- shortlist_items.match): no column changes there.

-- documents.status gains 'rejected': the processor classified the file as
-- something else than a CV (a cover letter, a diploma, a form). The error
-- column carries the sentence; a person may re-queue it like a failed one.
ALTER TABLE public.documents DROP CONSTRAINT documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'processed', 'needs_ocr', 'failed', 'rejected'));

-- What the classifier decided, kept for the audit: 'cv', 'other', or null
-- when the file was never classified (failed before, or processed before
-- this evolution).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_kind TEXT
  CHECK (document_kind IS NULL OR document_kind IN ('cv', 'other'));

CREATE OR REPLACE FUNCTION public.track_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.org_id, 'document.uploaded', 'document', NEW.id, NULL, NEW.candidate_id, jsonb_build_object('fileName', NEW.file_name));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('processed', 'failed', 'needs_ocr', 'rejected') THEN
    PERFORM public.log_activity(NEW.org_id, 'document.' || NEW.status, 'document', NEW.id, NULL, NEW.candidate_id,
      jsonb_build_object('fileName', NEW.file_name, 'method', NEW.structuring_method, 'kind', NEW.document_kind));
  END IF;
  RETURN NEW;
END;
$$;

-- Similar candidates: by meaning when both profiles carry a vector, else by
-- shared skills and headline through the full-text index. SECURITY INVOKER:
-- the caller's RLS decides what it sees. `similarity` is 0..1 (cosine
-- similarity, or a normalised text rank); `method` says which one answered.
CREATE OR REPLACE FUNCTION public.similar_candidates(
  p_org UUID,
  p_candidate UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (candidate_id UUID, similarity REAL, method TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_embedding extensions.vector(1024);
  v_terms TEXT;
  v_query tsquery;
BEGIN
  SELECT c.embedding,
         public.immutable_unaccent(coalesce(c.headline, '') || ' ' || array_to_string(c.skills, ' '))
    INTO v_embedding, v_terms
    FROM public.candidates c
   WHERE c.id = p_candidate AND c.org_id = p_org;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_embedding IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id, (1 - (c.embedding <=> v_embedding))::REAL, 'embedding'::TEXT
        FROM public.candidates c
       WHERE c.org_id = p_org AND c.status = 'active' AND c.id <> p_candidate AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> v_embedding
       LIMIT LEAST(GREATEST(p_limit, 1), 50);
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF btrim(coalesce(v_terms, '')) = '' THEN RETURN; END IF;
  -- Every word of the headline and skills, any of them matching (OR).
  v_query := websearch_to_tsquery('simple', regexp_replace(btrim(v_terms), '\s+', ' OR ', 'g'));
  RETURN QUERY
    SELECT c.id,
           LEAST(1.0, ts_rank_cd(c.fts, v_query) / NULLIF((SELECT max(ts_rank_cd(x.fts, v_query)) FROM public.candidates x WHERE x.org_id = p_org AND x.fts @@ v_query), 0))::REAL,
           'skills'::TEXT
      FROM public.candidates c
     WHERE c.org_id = p_org AND c.status = 'active' AND c.id <> p_candidate AND c.fts @@ v_query
     ORDER BY ts_rank_cd(c.fts, v_query) DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.similar_candidates(UUID, UUID, INTEGER) TO authenticated, service_role;
