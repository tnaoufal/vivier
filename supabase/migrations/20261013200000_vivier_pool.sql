-- Evolution 2, third step: a search remembers how many active candidates
-- the talent pool held when it ran. Up to 200 the whole pool is read;
-- above that the hybrid retrieval answers the 120 rows closest to the
-- brief and the rest is not looked at, and the brief page now says so
-- from this number instead of claiming every profile was read. Null for
-- searches stored before this column existed (the page then says nothing).
ALTER TABLE public.searches ADD COLUMN IF NOT EXISTS pool_size INTEGER
  CHECK (pool_size IS NULL OR pool_size >= 0);

-- A document the service set aside is not a CV the organisation paid to
-- have read into its pool: it does not count against the monthly quota
-- (the model call it cost is in ai_usage, like any other).
CREATE OR REPLACE FUNCTION public.cvs_processed_this_month(p_org UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::INTEGER FROM public.documents
  WHERE org_id = p_org
    AND status <> 'rejected'
    AND processed_at >= date_trunc('month', now());
$$;
