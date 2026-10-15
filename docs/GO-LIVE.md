# Go-live checklist (owner)

Everything a session cannot do from the repository: dashboards, secrets,
provider accounts. Work it in one block before the first real CV.

## Supabase (new project, EU region)

- [ ] Create the project `vivier_prod` in `eu-west-1` (or Frankfurt); note the
      project ref, the URL and the publishable key.
- [ ] Apply the ten files of `supabase/migrations` in order (`supabase link`
      then `supabase db push`, or the SQL editor): `20261013090000_vivier_init`,
      then evolution 2: `20261013180000_vivier_assessment` (status `rejected`,
      `documents.document_kind`, `similar_candidates()`),
      `20261013190000_vivier_dossier` (`shares.brief`, `candidates.phone_digits`
      and the dedup indexes, the `assess` usage kind, the re-embed index) and
      `20261013200000_vivier_pool` (`searches.pool_size`, and
      `cvs_processed_this_month()` no longer counts rejected documents), then
      evolution 3: `20261014090000_vivier_role_profile` (`briefs.role_profile`,
      JSONB, with its `UPDATE` grant to members; the screening's dimensions,
      the second opinion and the tier travel as JSON in `searches.results` and
      `shortlist_items.match`, no other column), then evolution 4:
      `20261014130000_vivier_photos` (`candidates.photo_path`,
      `organizations.show_photos` with its `UPDATE` grant, the private bucket
      `photos` with its read and delete policies), then evolution 5:
      `20261015090000_vivier_triage` (`search_triage`, one row per active
      candidate of a whole-pool search with the triage's verdict and reason,
      read by members under RLS; `start_triage()`, `record_triage()` and
      `merge_search_results()`, executable by the service role alone;
      `searches.assessed_count`, `match_count` and `near_count`, filled from
      the stored results; the method `triage` and the usage kind `triage`),
      then evolution 6: `20261015120000_vivier_similar_seniority`
      (`seniority_band()`, and `similar_candidates()` answering the
      neighbour's `years_experience`, the fifty nearest ordered by the
      distance between seniority bands first; it drops and recreates the
      function, so it can be re-run), then evolution 7:
      `20261015150000_vivier_analysis_jobs` (the job's columns of `searches`:
      `status`, `stage`, `progress_done`, `progress_total`, `stop_requested`,
      `error`, `started_at`, `finished_at`, `heartbeat_at`, `runner`,
      `analysis_model`, and the index the processor scans; on `search_triage`
      the screening's `score`, `score_reason`, `scored_at`, `forced` and
      `attempts`, with `record_screen()` and `bump_triage_attempts()`
      executable by the service role alone; the usage kind `screen`;
      `candidates.photo_checked_at` and the photo pass's index; the new
      columns are read by members under the existing policies and written
      by the processor and the Worker's server functions alone), then
      evolution 7 part B: `20261016090000_vivier_spaces` (`organizations.kind`,
      `team` or `personal`, with no `UPDATE` grant; `create_organization()`
      takes the kind as a fourth argument, `p_kind` (`team` by default), and
      the three-argument one is dropped, so PostgREST sees one signature;
      `accept_invitation()` makes a personal space a team when a second
      member joins; `organizations` joins the `supabase_realtime`
      publication).
      The evolution 2, 3, 6 and 7 files (part B's too) can be re-run;
      `vivier_init` and the photos and triage files create policies and stop
      on a second run (`policy … already exists`), so mark them applied
      rather than running them again. The dev project `vivier_dev`
      (ref `qtujdeolcdvlzwvpqpuv`, eu-west-1, free tier) carries all ten (checked on its schema on 2026-10-13: `document_kind`,
      `shares.brief`, `phone_digits`, `similar_candidates()`,
      `searches.pool_size` exist and the quota function excludes `rejected`;
      `briefs.role_profile` and `20261014130000` applied on 2026-10-14;
      `20261015090000` checked on 2026-10-14: the table, the three functions
      granted to the service role only, the three counts and both checks;
      `20261015120000` applied on 2026-10-15: `seniority_band()` and the
      `similar_candidates()` that answers `years_experience`;
      `20261015150000` and `20261016090000` applied on 2026-10-15 and
      checked on its schema the same day: the checks of the two items below
      hold, and every function the evolution 5 to 7 files define has the
      file's body, comments aside).
      Its `supabase_migrations.schema_migrations` does not match the files:
      it lists `20261013090000` (`vivier_init`), then `20261014124056`
      (`vivier_photos`) and evolution 5 in two parts, `20261014150558`
      (`vivier_triage`) and `20261014162202` (`vivier_search_counts`), then
      `20261014182710` (`vivier_triage_first_wins`) and `20261014191732`
      (`vivier_merge_keeps_assessment`), whose functions the triage file now
      holds, then `20261015090903` (`vivier_similar_seniority`),
      `20261015132417` (`vivier_analysis_jobs`) and `20261015201251`
      (`vivier_spaces`), each recorded under the time it was applied (read
      on 2026-10-15); evolutions 2 and 3 were applied outside the CLI and
      are not listed. Before a `db push`, run `supabase migration repair
      --status reverted 20261014124056 20261014150558 20261014162202
      20261014182710 20261014191732 20261015090903 20261015132417
      20261015201251` (the push refuses remote versions it has no file
      for), then `supabase migration repair --status applied 20261013180000
      20261013190000 20261013200000 20261014090000 20261014130000
      20261015090000 20261015120000 20261015150000 20261016090000`.
      Reset the dev database password in the dashboard before using it from
      a machine.
- [ ] Apply `20261015150000_vivier_analysis_jobs` on `vivier_dev` (the SQL
      editor, or `db push` after the repair above), then check
      `searches.status` and `search_triage.score` exist and `record_screen()`
      is granted to the service role alone. The evolution 7 processor reads
      `searches.status` at every scan and the Worker's `runSearch` inserts
      it: without the file, every claim and every "Analyser" fail.
      Record the date here as for the earlier files. Done on 2026-10-15
      (recorded above).
- [ ] Apply `20261016090000_vivier_spaces` on `vivier_dev`, then on the
      production project, before the Worker of evolution 7 part B serves;
      check `organizations.kind` exists (every existing row `team`), that
      `create_organization` has one signature (four arguments) and that
      `organizations` is in the `supabase_realtime` publication. The new web
      app calls `create_organization()` with the kind: without the file a
      person with no space yet cannot create one ("Je travaille seul" and
      "Je crée une équipe" both fail). Record the date here as for the
      earlier files. On `vivier_dev`: done on 2026-10-15 (recorded above;
      every check holds, and `kind` is not among the columns members may
      update); the production project is still to do.
- [ ] Default privileges for `anon` and `authenticated` are revoked by the
      migration: every later table or RPC meant for the browser needs its own
      `GRANT` (the migration shows the pattern).
- [ ] Auth: enable Email (confirmation on) and Google; add
      `https://<site>/app`, `https://<site>/app/account` (where a
      password-reset link lands; it redirects to `/app/settings`, where the
      password dialog opens) and `https://<site>/invite/*` to the redirect
      allow list; set the site URL.
- [ ] Storage: the migration created the private bucket `cvs` (25 MB, PDF only)
      and evolution 4 the private bucket `photos` (2 MB, PNG and JPEG; read by
      members, deleted by admins, written by the processor alone).
- [ ] Realtime: the migration added the collaborative tables to the
      `supabase_realtime` publication (evolution 7 part B adds
      `organizations`); check Realtime is on for the project.
- [ ] Enable Point-in-Time Recovery (Pro plan) and read `docs/BACKUPS.md`.
- [ ] Copy the service role key to the Cloudflare and Railway dashboards only.

## Cloudflare Workers (frontend)

- [ ] Create the Worker from this repository with the Git integration
      (root directory `vivier`, build `bun run build`, deploy with wrangler).
- [ ] Variables: `SITE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
      `PROCESSOR_URL`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
      `LLM_ASSESSMENT_MODEL` is read for `/status` only since evolution 7: the
      analysis's model is the processor's `LLM_ANALYSIS_MODEL` (see "Model
      vendor").
- [ ] Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `PROCESSOR_SHARED_SECRET`,
      `LLM_API_KEY`, `RESEND_API_KEY`.
- [ ] Check `/status` shows every part green without any value.
- [ ] Redeploy the Worker for evolution 7 part B, once `20261016090000` is
      applied (the merge to `main` deploys it through the Git integration;
      no variable or secret changes). The plane, the rail and the spaces are
      the web app's alone: the processor and `packages/analysis` do not
      change, so Railway needs no deploy. Then check that a new account
      offers "Je travaille seul" and that a personal space reads "Espace" on
      the rail.
- [ ] Rate limits: the `VIVIER_RATE_LIMITER` binding (`wrangler.jsonc`, 60
      calls a minute, mirrored by `RATE_LIMIT_POLICY` in
      `src/lib/platform/rate-limit.server.ts`) counts per scope, per address
      (an IPv6 by its /64) and per user, in each data centre; the `triage`
      and `assess` scopes count per user alone once the member is known,
      so recruiters behind one office address do not share a bucket. Since
      evolution 7 an analysis spends `search` alone, once per click
      ("Analyser", "Relancer", "Reprendre", "Lire quand même"): its model
      calls are the processor's, paced by `ANALYSIS_CONCURRENCY` and the
      provider's own refusals (sent again after 2, 6, 15, 30 and 60 seconds, or the
      `Retry-After` named, then the run fails), never by this binding; the
      `triage` and `assess` scopes stay declared and unused. If teams report
      `RATE:limited` on other actions, raise `simple.limit` in
      `wrangler.jsonc` and `RATE_LIMIT_POLICY` together, and deploy.

## Railway (processor)

- [ ] New service from this repository: root directory `vivier`, Dockerfile
      `services/processor/Dockerfile`, health check path `/health`.
- [ ] Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `PROCESSOR_SHARED_SECRET` (the same 32+ character secret as the Worker),
      `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`,
      optionally `MISTRAL_OCR_API_KEY` for scanned PDFs. `PROCESSOR_CONCURRENCY`
      now defaults to 4 (was 2): set it only to lower it when the model answers 429.
      Evolution 7 adds `LLM_ANALYSIS_MODEL` (the model every call of an
      analysis goes to; `LLM_MODEL` unless set: see "Model vendor"),
      `ANALYSIS_CONCURRENCY` (model calls one analysis keeps in flight, 4;
      lower it on 429), `ANALYSIS_MAX_RUNS` (analyses one process runs at
      once, 2) and `ANALYSIS_POLL_INTERVAL_MS` (the scan for queued and stale
      runs, 30 s); the defaults need no variable.
- [ ] Redeploy the processor for evolution 7, after the migration and before
      the Worker: the analysis runs there now, the web app only queues
      `searches` rows, and a processor built before this evolution never
      claims them (the brief's state block waits on "En attente"). The
      image builds the shared package `packages/analysis` and ships its
      `dist/`; add `packages/analysis/**` to the service's watch paths.
      After the deploy the `listening` log line shows `analysisConcurrency`, `analysisMaxRuns`
      and `analysisPollIntervalMs`, and the first analysis logs
      `analysis_claimed`, one `analysis_step` line per stage and
      `analysis_done`; `GET /metrics` counts `analysesRunning`.
- [ ] `LLM_EMBEDDING_MODEL=mistral-embed` is set on the Railway service. The
      candidates processed on 2026-10-13 had no vector for another reason: the
      processor's `openai` SDK asked Mistral for base64 embeddings, Mistral
      answered floats, and the SDK decoded them into a 256-wide vector (fixed:
      both embedding calls now state `encoding_format: "float"`). After each
      processor deploy, the startup probe must log
      `embedding_ok { dimensions: 1024 }` and `GET /health` must answer
      `"embedding": "ok"`; a `mismatch` or `unavailable` names what to fix. The
      hourly re-embed pass then gives the existing candidates a vector (100 a
      pass); `POST /maintenance` with the bearer runs it now.
- [ ] After the first deploy: check the logs show `polling: true` and `/status` sees it.
- [ ] The photo needs unpdf 0.12.2 at least (`extractImages` answering sized
      images; the floor in `services/processor/package.json`, to keep when the
      lockfile is generated). An older unpdf logs `photo_images_unsupported`
      and gives no photo, never a failed document; after the first CVs the logs
      show `photo_written` lines and `candidate_written` says `photo: true`.
      Candidates read before this deploy get theirs from the hourly
      maintenance pass once `20261015150000` is applied (the photo pass:
      50 a batch, up to 10 batches a run, the newest CV with a text layer
      only, every candidate marked checked once in `photo_checked_at`); the
      report's `photosChecked` and `photosFound` say how far it is, and
      `POST /maintenance` with the bearer runs it now.

## Model vendor

- [ ] Mistral (recommended, EU): create an API key; `LLM_BASE_URL=https://api.mistral.ai/v1`,
      `LLM_MODEL=mistral-small-latest`, `LLM_EMBEDDING_MODEL=mistral-embed`.
      Sign the data processing terms; confirm no training on API data.
- [ ] Alternative: OpenAI (`LLM_BASE_URL=https://api.openai.com/v1`,
      `LLM_EMBEDDING_MODEL=text-embedding-3-small`, shortened to 1024 dimensions automatically).
- [ ] An analysis runs on the processor, every call of it, on
      `LLM_ANALYSIS_MODEL` (the Railway service; `LLM_MODEL` unless set): the
      one reading of the brief (kind `brief`), the triage (kind `triage`:
      every active profile of the pool sorted by métier, forty per call,
      from a card without name, contact details, place, link or CV text),
      the screening (kind `screen`: the profiles kept scored 0..100 against
      the brief's reading, twenty-five per call, from the same card), then
      three passes (kind `assess`) on the thirty best: the full reading (one
      call per profile, the five dimensions with their evidence), the second
      opinion (one more call per retained profile) and the tiering (one call
      per group of up to eight retained or borderline profiles, then one for
      the A's of every group). They decide which CVs a hiring team sees, and
      the triage, the screening and the full reading judge first whether the
      candidate's métier is the job from what the person did, not from the
      titles (a semantic judgement a small model gets wrong more often): set
      `LLM_ANALYSIS_MODEL=mistral-medium-latest` (or `mistral-large-latest`
      when budget allows) on Railway for those calls alone and keep
      `LLM_MODEL=mistral-small-latest` for the structuring. Unset,
      `LLM_MODEL` does them too; the Worker's `LLM_ASSESSMENT_MODEL` no
      longer takes part. What a run costs: one reading of the brief (the
      text clipped to 12 000 characters in, 3 200 tokens out at most) only
      when the brief was never read or its text changed, then one triage
      call per 40 profiles (about 16 000 characters in at most, 5 000 tokens
      out at most), one screening call per 25 profiles kept (the same cards,
      about 2 700 tokens out at most), thirty full readings (about 9 000
      characters, roughly 3 000 tokens in and, with the dimensions and the
      lists, 1 800 to 3 200 out), then one second-reading call per retained
      profile (the same input, 400 out) and one tiering call per group of
      eight (a few thousand characters in, 120 out per candidate), plus one
      for the A's. A pool of 1 000 profiles of which 150 are kept is 25
      triage calls, 6 screening calls and 30 full readings, then at most 30
      second readings and 5 tiering calls: a hundred calls at most, roughly
      a third of a million tokens in and 150 000 out, whatever the pool
      holds beyond the thirty best (the earlier funnel read every profile
      kept in full). At Mistral's list prices at the time of writing that is
      a fraction of what the earlier funnel cost, a few euros at the very
      most with `mistral-large-latest` (check the current price list before
      deciding); `ai_usage.model` and `searches.analysis_model` say which
      model answered.

## Resend

- [ ] Verify the sending domain; set `EMAIL_FROM` (e.g. `Vivier <hello@vivier.app>`).
- [ ] `SITE_URL` is required for sharing by email: the link in the email is
      built from it and `sendShare` refuses a link on another origin; without it
      the share dialog only offers the link to copy. Share emails set Reply-To
      to the sender's confirmed address (`EMAIL_REPLY_TO` is the fallback).
- [ ] Without `LLM_API_KEY` on the processor no analysis runs: the run
      fails at its claim (`model_unavailable`) and the brief's state block
      says "Échec · Modèle indisponible" with "Réessayer"; the Worker's key
      serves `/status`, the brief page's capability and the dossier
      draft's option only. With a key on the processor, the one reading of a brief (`brief`), the triage
      (`triage`), the screening (`screen`) and the three passes (`assess`)
      record `ai_usage` rows for the organisation (`summary`, a dossier draft
      reworded by the model, is an option of `draftShare` the one-step dialog
      never asks for). An analysis stored on the text alone before evolution
      7 still reads "Texte seul, sans modèle".

## Legal

- [ ] Complete the publisher's identity and the contact address in
      `src/components/legal-page.tsx` (Contact sections).
- [ ] Sign the DPAs: Supabase, Cloudflare, Railway, Resend, the model vendor.
- [ ] Decide the default retention (24 months) and tell customers to inform
      candidates (the dossier page and the privacy policy already say a model is
      used; the notice in `docs/RGPD.md` now describes the assessment).
- [ ] Photos: `organizations.show_photos` is on by default; an administrator
      turns it off per organisation on `/app/settings` (a team that practises
      anonymous CVs). Tell customers the photo read from a CV is kept to
      identify the person in the interface only, never sent to the model nor
      shown on a dossier, erased with the candidate and linked from the export
      (the notice in `docs/RGPD.md` and the privacy policy in
      `src/components/legal-page.tsx` already say so).
- [ ] A document set aside as "not a CV" that is pinned to no candidate (an
      identity document uploaded by mistake) is purged by nothing and deleted
      by no button yet: until that evolution, delete such rows with the service
      role when a customer asks (README "Not built yet").

## Billing (phase 7, not built yet)

- [ ] Paddle catalog: Team monthly/yearly, Business monthly/yearly; webhook
      to `/api/paddle/webhook` calling `sync_plan_from_billing()`.
- [ ] Until then every organisation is on the trial quota of 200 CV a month
      (`organizations.cv_quota_month`, raised per organisation by the owner in
      the database); a CV the processor refused at the cap waits as "en attente
      de quota" and is re-queued from the processing line of the talent
      pool's list once the quota allows.

## Repository

- [ ] Require the `Vivier frontend` and `Vivier processor` checks in the ruleset.
- [ ] Move to a dedicated repository (`docs/EXTRACT.md`).
- [ ] Allow `registry.npmjs.org` in the cloud environment's network settings so
      a session can install, typecheck and format; then run `bun run format`
      and commit `services/processor/package-lock.json`.
- [ ] `package.json` still declares `cmdk` although `src/components/ui/command.tsx`
      is gone (the lockfile is frozen): drop it the next time `bun.lock` is
      regenerated.

## Backups (docs/BACKUPS.md)

- [ ] Supabase: Pro plan with the Point-in-Time Recovery add-on (note the retention window).
- [ ] Supabase → Database: the **Session pooler** connection string (port 5432, IPv4) with
      `?sslmode=require`; not the transaction pooler, not the direct host.
- [ ] Supabase → Storage → Settings → S3 connection enabled; one pair of S3 access keys made
      for the backup only; note the endpoint (`https://<ref>.storage.supabase.co/storage/v1/s3`)
      and the project's region.
- [ ] Cloudflare R2: bucket `vivier-backups` (EU jurisdiction) and an API token scoped to it
      with Object Read & Write; endpoint `https://<account_id>.r2.cloudflarestorage.com`.
- [ ] GitHub → Settings → Secrets and variables → Actions, secrets: `VIVIER_DATABASE_URL`,
      `VIVIER_R2_ENDPOINT`, `VIVIER_R2_BUCKET`, `VIVIER_R2_ACCESS_KEY_ID`,
      `VIVIER_R2_SECRET_ACCESS_KEY`, `VIVIER_SUPABASE_S3_ENDPOINT`,
      `VIVIER_SUPABASE_S3_ACCESS_KEY_ID`, `VIVIER_SUPABASE_S3_SECRET_ACCESS_KEY`;
      variable `VIVIER_SUPABASE_S3_REGION` (e.g. `eu-west-1`).
- [ ] Actions → "Vivier backup" → Run workflow once by hand: the summary shows `"ok":true`,
      the bucket shows `vivier/db/` and `vivier/storage/cvs/`. Until the secrets exist the
      workflow ends green with a "skipped" notice; the schedule (03:17 UTC) runs from `main` only.
- [ ] Restore drill before go-live, on a fresh project, following docs/BACKUPS.md; record
      here: date ______, dump stamp ______, time taken ______, what failed ______.
- [ ] Quarterly drill in the calendar; a monthly glance at the Actions tab (GitHub pauses a
      schedule after sixty days without a commit).
- [ ] Cloudflare's DPA covers R2 as a sub-processor and the privacy policy lists backups
      (docs/RGPD.md "Who is who").
- [ ] The backup mirrors the `cvs` bucket only (`scripts/backup.sh`, one bucket under
      `storage/cvs`): `photos` is not copied. After a restore, a profile whose photo
      object is gone shows initials; its `photo_path` stays and no later CV replaces it.
      Decide whether to accept that or to extend the script and `docs/BACKUPS.md` to a
      second bucket.
