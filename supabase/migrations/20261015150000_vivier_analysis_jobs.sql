-- Evolution 7, part A: the analysis is a job the processor runs, never
-- the browser. The web app's runSearch creates the searches row with
-- status 'queued' and pokes the processor; the processor claims it
-- (status 'running', its name as runner, a heartbeat as it works),
-- scans the table every 30 s for queued rows and for running rows whose
-- heartbeat went stale (a lost poke, a crash or a redeploy never loses
-- a run), and resumes at boot; a person stops a run by setting
-- stop_requested through a server function. The browser subscribes to
-- the row (the realtime publication already carries searches) and shows
-- the stage and the progress. Rows stored before the job existed read
-- 'done'. The funnel is bounded: after the triage, the kept profiles
-- (yes, close) are screened (a score 0..100 against the brief's reading
-- and a short reason, on search_triage), and only the best enter the
-- results for the full reading; a row a person brought back is 'forced'
-- in, and a card the model could not read keeps its attempts. The
-- photos: a maintenance pass reads the portrait of every candidate
-- without one from their stored CV, once (photo_checked_at).

-- ---------------------------------------------------------------------
-- searches: the job
-- ---------------------------------------------------------------------

ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'
  CHECK (status IN ('queued', 'running', 'stopped', 'done', 'failed'));
-- The stage the run is at (reading, snapshot, triage, screening, promotion,
-- assessing, challenging, ranking, final: STAGE_ORDER of @vivier/analysis),
-- the last one reached once it stopped.
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS progress_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS progress_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS stop_requested BOOLEAN NOT NULL DEFAULT false;
-- One sentence for the team when the run failed.
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
-- The processor instance that holds the run.
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS runner TEXT;
-- The chat model the run's calls went to.
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS analysis_model TEXT;

-- What the processor scans: the rows to claim, oldest first.
CREATE INDEX IF NOT EXISTS searches_active_idx ON public.searches (status, created_at)
  WHERE status IN ('queued', 'running');

-- ---------------------------------------------------------------------
-- search_triage: the screening's score, the forced rows, the attempts
-- ---------------------------------------------------------------------

ALTER TABLE public.search_triage ADD COLUMN IF NOT EXISTS score INTEGER
  CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE public.search_triage ADD COLUMN IF NOT EXISTS score_reason TEXT
  CHECK (score_reason IS NULL OR char_length(score_reason) <= 300);
-- Set once the screening read the card, score or not: a card the model
-- could not score keeps a null score and is never sent again.
ALTER TABLE public.search_triage ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;
-- A person brought the profile back to be read in full: the promotion
-- always takes it, whatever its score.
ALTER TABLE public.search_triage ADD COLUMN IF NOT EXISTS forced BOOLEAN NOT NULL DEFAULT false;
-- How many failed batches held the card; the runner settles a card past the limit.
ALTER TABLE public.search_triage ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- The promotion reads the kept rows by score.
CREATE INDEX IF NOT EXISTS search_triage_kept_score_idx
  ON public.search_triage (search_id, score DESC NULLS LAST)
  WHERE verdict IN ('yes', 'close');

-- One batch of scores written in one statement: [{candidate_id, score, reason}].
-- The first write wins: a batch sent again never overwrites a card
-- already screened; a null score marks a card the model could not score.
CREATE OR REPLACE FUNCTION public.record_screen(p_org UUID, p_search UUID, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE public.search_triage t
  SET score = r.score,
      score_reason = left(r.reason, 300),
      scored_at = now()
  FROM jsonb_to_recordset(p_rows) AS r(candidate_id UUID, score INTEGER, reason TEXT)
  WHERE t.search_id = p_search
    AND t.org_id = p_org
    AND t.candidate_id = r.candidate_id
    AND t.score IS NULL
    AND t.scored_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

-- One more failed batch on these cards, in one statement (PostgREST cannot
-- add one to a column in place).
CREATE OR REPLACE FUNCTION public.bump_triage_attempts(p_search UUID, p_candidates UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE public.search_triage
  SET attempts = attempts + 1
  WHERE search_id = p_search
    AND candidate_id = ANY (p_candidates);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.record_screen(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_triage_attempts(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_screen(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_triage_attempts(UUID, UUID[]) TO service_role;

-- Members read search_triage already (the policy of evolution 5); nothing
-- else is granted: the runner writes with the service role, the web app's
-- server functions through the service client.

-- ---------------------------------------------------------------------
-- ai_usage: the screening's calls
-- ---------------------------------------------------------------------

ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_kind_check CHECK (kind = ANY (ARRAY['structure'::text, 'embed'::text, 'ocr'::text, 'brief'::text, 'explain'::text, 'summary'::text, 'assess'::text, 'triage'::text, 'screen'::text]));

-- ---------------------------------------------------------------------
-- candidates: the photo pass
-- ---------------------------------------------------------------------

-- When the processor last looked for a portrait in the candidate's CV;
-- null until the maintenance pass checked them once.
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS photo_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS candidates_photo_pending_idx ON public.candidates (org_id)
  WHERE photo_path IS NULL AND photo_checked_at IS NULL;
