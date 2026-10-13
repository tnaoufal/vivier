# Go-live checklist (owner)

Everything a session cannot do from the repository: dashboards, secrets,
provider accounts. Work it in one block before the first real CV.

## Supabase (new project, EU region)

- [ ] Create the project `vivier_prod` in `eu-west-1` (or Frankfurt); note the
      project ref, the URL and the publishable key.
- [ ] Apply the four files of `supabase/migrations` in order (`supabase link`
      then `supabase db push`, or the SQL editor): `20261013090000_vivier_init`,
      then evolution 2: `20261013180000_vivier_assessment` (status `rejected`,
      `documents.document_kind`, `similar_candidates()`),
      `20261013190000_vivier_dossier` (`shares.brief`, `candidates.phone_digits`
      and the dedup indexes, the `assess` usage kind, the re-embed index) and
      `20261013200000_vivier_pool` (`searches.pool_size`, and
      `cvs_processed_this_month()` no longer counts rejected documents). All
      four are safe to re-run. The dev project `vivier_dev` (ref
      `qtujdeolcdvlzwvpqpuv`, eu-west-1, free tier) carries all four (checked
      on its schema on 2026-10-13: `document_kind`, `shares.brief`,
      `phone_digits`, `similar_candidates()`, `searches.pool_size` exist and
      the quota function excludes `rejected`). The three evolution-2 files were
      applied outside the CLI, so `supabase_migrations.schema_migrations` lists
      only `vivier_init`: run `supabase migration repair --status applied
      20261013180000 20261013190000 20261013200000` before a `db push`, or let
      the push re-run them. Reset the dev database password in the dashboard
      before using it from a machine.
- [ ] Default privileges for `anon` and `authenticated` are revoked by the
      migration: every later table or RPC meant for the browser needs its own
      `GRANT` (the migration shows the pattern).
- [ ] Auth: enable Email (confirmation on) and Google; add
      `https://<site>/app`, `https://<site>/app/account` and
      `https://<site>/invite/*` to the redirect allow list; set the site URL.
- [ ] Storage: the migration created the private bucket `cvs` (25 MB, PDF only).
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

## Railway (processor)

- [ ] New service from this repository: root directory `vivier`, Dockerfile
      `services/processor/Dockerfile`, health check path `/health`.
- [ ] Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `PROCESSOR_SHARED_SECRET` (the same 32+ character secret as the Worker),
      `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`,
      optionally `MISTRAL_OCR_API_KEY` for scanned PDFs. `PROCESSOR_CONCURRENCY`
      now defaults to 4 (was 2): set it only to lower it when the model answers 429.
- [ ] **Set `LLM_EMBEDDING_MODEL=mistral-embed` on the Railway service** (the
      current deployment runs without it, so the candidates processed so far
      have no vector), then **redeploy the processor** so the startup probe
      runs: the logs show `embedding_ok { dimensions: 1024 }` and `GET /health`
      answers `"embedding": "ok"`. A `mismatch` or `unavailable` there names
      what to fix. The hourly re-embed pass then gives the existing candidates
      a vector (100 a pass); `POST /maintenance` with the bearer runs it now.
- [ ] After the first deploy: check the logs show `polling: true` and `/status` sees it.

## Model vendor

- [ ] Mistral (recommended, EU): create an API key; `LLM_BASE_URL=https://api.mistral.ai/v1`,
      `LLM_MODEL=mistral-small-latest`, `LLM_EMBEDDING_MODEL=mistral-embed`.
      Sign the data processing terms; confirm no training on API data.
- [ ] Alternative: OpenAI (`LLM_BASE_URL=https://api.openai.com/v1`,
      `LLM_EMBEDDING_MODEL=text-embedding-3-small`, shortened to 1024 dimensions automatically).
- [ ] The expert assessment (`assessCandidates`: one call per profile read, kind
      `assess`) is what decides which CVs a hiring team sees as matching the
      brief: when budget allows, set `LLM_ASSESSMENT_MODEL=mistral-medium-latest`
      on the Worker for that call alone and keep `LLM_MODEL=mistral-small-latest`
      for structuring, criteria and dossier drafts. Unset, `LLM_MODEL` assesses
      too. An analysis of a 200-profile pool is 200 calls of about 9 000
      characters each; `ai_usage.model` says which model answered.

## Resend

- [ ] Verify the sending domain; set `EMAIL_FROM` (e.g. `Vivier <hello@vivier.app>`).
- [ ] `SITE_URL` is required for sharing by email: the link in the email is
      built from it and `sendShare` refuses a link on another origin; without it
      the share dialog only offers the link to copy. Share emails set Reply-To
      to the sender's confirmed address (`EMAIL_REPLY_TO` is the fallback).
- [ ] Without `LLM_API_KEY` the brief page says no model is set up, criteria
      are typed by hand and every analysis runs on text only, without
      assessment (shown on the page); with a key, proposals, derived criteria,
      hybrid retrieval, assessments and dossier drafts record `ai_usage` rows
      of kinds `brief`, `embed`, `assess` and `summary`.

## Legal

- [ ] Complete the publisher's identity and the contact address in
      `src/components/legal-page.tsx` (Contact sections).
- [ ] Sign the DPAs: Supabase, Cloudflare, Railway, Resend, the model vendor.
- [ ] Decide the default retention (24 months) and tell customers to inform
      candidates (the dossier page and the privacy policy already say a model is
      used; the notice in `docs/RGPD.md` now describes the assessment).
- [ ] A document set aside as "not a CV" that is pinned to no candidate (an
      identity document uploaded by mistake) is purged by nothing and deleted
      by no button yet: until that evolution, delete such rows with the service
      role when a customer asks (README "Not built yet").

## Billing (phase 7, not built yet)

- [ ] Paddle catalog: Team monthly/yearly, Business monthly/yearly; webhook
      to `/api/paddle/webhook` calling `sync_plan_from_billing()`.

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
