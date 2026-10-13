-- Evolution 2, second step: the share keeps a snapshot of the brief it
-- presents (the dossier's cover reads it, whatever the brief becomes
-- later); candidates get the columns and indexes the processor's
-- stronger deduplication reads (an email, the digits of a phone number);
-- the usage log learns the assessment kind; the re-embed job finds the
-- candidates without a vector cheaply.

-- The brief as it was when the share was created: { title, summary,
-- requirements: [{ label, required }] }. Null for shares created before.
ALTER TABLE public.shares ADD COLUMN IF NOT EXISTS brief JSONB;
GRANT SELECT (brief) ON public.shares TO authenticated;

-- The digits of the phone number, computed by the database so a "+33 6 12"
-- and a "06.12" meet on the same key. Never written by anyone.
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS phone_digits TEXT
  GENERATED ALWAYS AS (NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) STORED;
CREATE INDEX IF NOT EXISTS candidates_org_phone_digits_idx
  ON public.candidates (org_id, phone_digits) WHERE phone_digits IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_org_email_lower_idx
  ON public.candidates (org_id, lower(email)) WHERE email IS NOT NULL;
-- Active candidates still without a vector: what the hourly re-embed pass lists.
CREATE INDEX IF NOT EXISTS candidates_missing_embedding_idx
  ON public.candidates (org_id, updated_at) WHERE embedding IS NULL AND status = 'active';

-- The model's assessment of a candidate against a brief is its own usage kind.
ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_kind_check
  CHECK (kind IN ('structure', 'embed', 'ocr', 'brief', 'explain', 'summary', 'assess'));
