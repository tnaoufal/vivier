-- Evolution 4 (design): the candidate's photo, read from the first page of
-- the CV by the processor and kept as a small PNG in the private `photos`
-- bucket (<org_id>/<candidate_id>.png, or .jpg for a JPEG the OCR cut out).
-- It identifies a person in the
-- interface and never reaches the model. An organisation that practises
-- anonymous CVs turns the display off (show_photos). The photo leaves with
-- the candidate (erasure, retention purge) and is listed in the export.
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS show_photos BOOLEAN NOT NULL DEFAULT true;
GRANT UPDATE (show_photos) ON public.organizations TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', false, 2097152, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "photos: members read their organisation's photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.is_org_member(((storage.foldername(name))[1])::uuid));

CREATE POLICY "photos: admins delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin'));
