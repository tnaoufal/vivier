-- Evolution 3: the brief keeps the structured understanding of the job a
-- senior recruiter builds before reading a single CV (domain, seniority,
-- core missions, equivalent titles, adjacent profiles, context, must-haves,
-- success factors, interview points). Written by the server when the
-- analysis derives it, edited by the team in the brief page. The
-- assessment of each candidate (dimensions, strengths, concerns, questions,
-- tier) travels as JSON inside searches.results and shortlist_items.match:
-- no column change there.
ALTER TABLE public.briefs ADD COLUMN IF NOT EXISTS role_profile JSONB;
GRANT UPDATE (role_profile) ON public.briefs TO authenticated;
