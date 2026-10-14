# Go-live checklist (owner)

Everything a session cannot do from the repository: dashboards, secrets,
provider accounts. Work it in one block before the first real CV.

## Supabase (new project, EU region)

- [ ] Create the project `vivier_prod` in `eu-west-1` (or Frankfurt); note the
      project ref, the URL and the publishable key.
- [ ] Apply the seven files of `supabase/migrations` in order (`supabase link`
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
      the stored results; the method `triage` and the usage kind `triage`).
      The evolution 2 and 3 files can be re-run; `vivier_init` and the
      photos and triage files create policies and stop on a second run
      (`policy … already exists`), so mark them applied rather than running
      them again. The dev project `vivier_dev` (ref `qtujdeolcdvlzwvpqpuv`,
      eu-west-1, free tier) carries all seven (checked on its schema on 2026-10-13: `document_kind`,
      `shares.brief`, `phone_digits`, `similar_candidates()`,
      `searches.pool_size` exist and the quota function excludes `rejected`;
      `briefs.role_profile` and `20261014130000` applied on 2026-10-14;
      `20261015090000` checked on 2026-10-14: the table, the three functions
      granted to the service role only, the three counts and both checks).
      Its `supabase_migrations.schema_migrations` does not match the files:
      it lists `20261013090000` (`vivier_init`), then `20261014124056`
      (`vivier_photos`) and evolution 5 in two parts, `20261014150558`
      (`vivier_triage`) and `20261014162202` (`vivier_search_counts`),
      recorded under the time they were applied; evolutions 2 and 3 were
      applied outside the CLI and are not listed. Before a `db push`, run
      `supabase migration repair --status reverted 20261014124056
      20261014150558 20261014162202` (the push refuses remote versions it
      has no file for), then `supabase migration repair --status applied
      20261013180000 20261013190000 20261013200000 20261014090000
      20261014130000 20261015090000`. Reset the dev database password in
      the dashboard before using it from a machine.
- [ ] Default privileges for `anon` and `authenticated` are revoked by the
      migration: every later table or RPC meant for the browser needs its own
      `GRANT` (the migration shows the pattern).
- [ ] Auth: enable Email (confirmation on) and Google; add
      `https://<site>/app`, `https://<site>/app/account` and
      `https://<site>/invite/*` to the redirect allow list; set the site URL.
- [ ] Storage: the migration created the private bucket `cvs` (25 MB, PDF only)
      and evolution 4 the private bucket `photos` (2 MB, PNG and JPEG; read by
      members, deleted by admins, written by the processor alone).
- [ ] Realtime: the migration added the collaborative tables to the
      `supabase_realtime` publication; check Realtime is on for the project.
- [ ] Enable Point-in-Time Recovery (Pro plan) and read `docs/BACKUPS.md`.
- [ ] Copy the service role key to the Cloudflare and Railway dashboards only.

## Cloudflare Workers (frontend)

- [ ] Create the Worker from this repository with the Git integration
      (root directory `vivier`, build `bun run build`, deploy with wrangler).
- [ ] Variables: `SITE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
      `PROCESSOR_URL`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`, `EMAIL_FROM`, `EMAIL_REPLY_TO`;
      optionally `LLM_ASSESSMENT_MODEL` (see "Model vendor").
- [ ] Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `PROCESSOR_SHARED_SECRET`,
      `LLM_API_KEY`, `RESEND_API_KEY`.
- [ ] Check `/status` shows every part green without any value.
- [ ] Rate limits: the `VIVIER_RATE_LIMITER` binding (`wrangler.jsonc`, 60
      calls a minute, mirrored by `RATE_LIMIT_POLICY` in
      `src/lib/platform/rate-limit.server.ts`) counts per scope, per address
      (an IPv6 by its /64) and per user, in each data centre; the `triage`
      and `assess` scopes count per user alone once the member is known,
      so recruiters behind one office address do not share a bucket. An
      analysis spends three scopes: `search` (the search, the snapshot's
      extension and the promotion), `triage` (four calls in flight) and
      `assess` (the screening two in flight, then the second opinion and
      the tiering). A refused analysis call waits 20, 40 then 65 seconds
      before it fails, and the end of its stage or "Reprendre" sends it
      again, so nothing is lost; but a very fast model can bring four
      triage calls near sixty a minute. If teams report long pauses,
      raise `simple.limit` in `wrangler.jsonc` and `RATE_LIMIT_POLICY`
      together, and deploy.

## Railway (processor)

- [ ] New service from this repository: root directory `vivier`, Dockerfile
      `services/processor/Dockerfile`, health check path `/health`.
- [ ] Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `PROCESSOR_SHARED_SECRET` (the same 32+ character secret as the Worker),
      `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`,
      optionally `MISTRAL_OCR_API_KEY` for scanned PDFs. `PROCESSOR_CONCURRENCY`
      now defaults to 4 (was 2): set it only to lower it when the model answers 429.
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
      Candidates read before this deploy have no photo until a new CV of
      theirs with a portrait is processed.

## Model vendor

- [ ] Mistral (recommended, EU): create an API key; `LLM_BASE_URL=https://api.mistral.ai/v1`,
      `LLM_MODEL=mistral-small-latest`, `LLM_EMBEDDING_MODEL=mistral-embed`.
      Sign the data processing terms; confirm no training on API data.
- [ ] Alternative: OpenAI (`LLM_BASE_URL=https://api.openai.com/v1`,
      `LLM_EMBEDDING_MODEL=text-embedding-3-small`, shortened to 1024 dimensions automatically).
- [ ] An analysis runs on the assessment model: the triage
      (`triageCandidates`, kind `triage`: every active profile of the pool
      sorted by métier, forty per call, from a card without name, contact
      details, place, link or CV text), then three passes (kind `assess`) on
      the profiles it kept: the screening (`assessCandidates`: one call per
      profile kept, the five dimensions with their evidence), the second
      opinion (`challengeCandidates`: one more call per retained profile)
      and the tiering (`rankCandidates`: one call per group of up to eight
      retained or borderline profiles, then one for the A's of every group).
      They decide which CVs a hiring team sees, and the triage and the
      screening both judge first whether the candidate's métier is the job
      from what the person did, not from the titles (a semantic judgement a
      small model gets wrong more often): set
      `LLM_ASSESSMENT_MODEL=mistral-medium-latest` (or `mistral-large-latest`
      when budget allows) on the Worker for those calls alone and keep
      `LLM_MODEL=mistral-small-latest` for structuring, criteria, the role
      profile and dossier drafts. Unset, `LLM_MODEL` does them too. What a
      run costs: one triage call per 40 profiles (about 16 000 characters in
      at most, 5 000 tokens out at most) plus one screening per profile kept
      (about 9 000 characters, roughly 3 000 tokens in and, with the
      dimensions and the lists, 1 500 to 2 500 out), then one second-opinion
      call per retained profile (the same input, about 100 out) and one
      tiering call per group of eight (a few thousand characters in, about
      100 out per candidate). A pool of 1 000 profiles of which 150 are kept
      and thirty retained is some 215 calls (25 of them the triage), roughly
      0.7 M tokens in and 0.4 M out, the output weighing as much as the
      input in the bill: the cost follows the profiles kept, not the size of
      the pool. At Mistral's list prices at the time of
      writing that is a few euros at most with `mistral-medium-latest` and
      several with `mistral-large-latest` (check the current price list before
      deciding); `ai_usage.model` says which model answered each call. The
      role profile is one `brief` call per brief on `LLM_MODEL`, once.

## Resend

- [ ] Verify the sending domain; set `EMAIL_FROM` (e.g. `Vivier <hello@vivier.app>`).
- [ ] `SITE_URL` is required for sharing by email: the link in the email is
      built from it and `sendShare` refuses a link on another origin; without it
      the share dialog only offers the link to copy. Share emails set Reply-To
      to the sender's confirmed address (`EMAIL_REPLY_TO` is the fallback).
- [ ] Without `LLM_API_KEY` the brief page says no model is set up, the role
      profile and the criteria are typed by hand and every analysis runs on
      text only, without triage, screening, second opinion or tiering (shown
      on the page); with a key, proposals, derived criteria and the role
      profile (`brief`), hybrid retrieval (`embed`), the triage (`triage`),
      the three passes (`assess`) and dossier drafts (`summary`) record
      `ai_usage` rows.

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
      de quota" and is re-queued from the talent pool's banner once the quota
      allows.

## Repository

- [ ] Require the `Vivier frontend` and `Vivier processor` checks in the ruleset.
- [ ] Move to a dedicated repository (`docs/EXTRACT.md`).
- [ ] Allow `registry.npmjs.org` in the cloud environment's network settings so
      a session can install, typecheck and format; then run `bun run format`
      and commit `services/processor/package-lock.json`.

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
