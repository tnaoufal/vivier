# Go-live checklist (owner)

Everything a session cannot do from the repository: dashboards, secrets,
provider accounts. Work it in one block before the first real CV.

## Supabase (new project, EU region)

- [ ] Create the project `vivier_prod` in `eu-west-1` (or Frankfurt); note the
      project ref, the URL and the publishable key.
- [ ] Apply `supabase/migrations/20261013090000_vivier_init.sql`
      (`supabase link` then `supabase db push`, or the SQL editor).
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
      `PROCESSOR_URL`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
- [ ] Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `PROCESSOR_SHARED_SECRET`,
      `LLM_API_KEY`, `RESEND_API_KEY`.
- [ ] Check `/status` shows every part green without any value.

## Railway (processor)

- [ ] New service from this repository: root directory `vivier`, Dockerfile
      `services/processor/Dockerfile`, health check path `/health`.
- [ ] Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `PROCESSOR_SHARED_SECRET` (the same 32+ character secret as the Worker),
      `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`,
      optionally `MISTRAL_OCR_API_KEY` for scanned PDFs.
- [ ] After the first deploy: check the logs show `polling: true` and `/status` sees it.

## Model vendor

- [ ] Mistral (recommended, EU): create an API key; `LLM_BASE_URL=https://api.mistral.ai/v1`,
      `LLM_MODEL=mistral-small-latest`, `LLM_EMBEDDING_MODEL=mistral-embed`.
      Sign the data processing terms; confirm no training on API data.
- [ ] Alternative: OpenAI (`LLM_BASE_URL=https://api.openai.com/v1`,
      `LLM_EMBEDDING_MODEL=text-embedding-3-small`, shortened to 1024 dimensions automatically).

## Resend

- [ ] Verify the sending domain; set `EMAIL_FROM` (e.g. `Vivier <hello@vivier.app>`).
- [ ] `SITE_URL` is required for sharing by email: the link in the email is
      built from it and `sendShare` refuses a link on another origin; without it
      the share dialog only offers the link to copy. Share emails set Reply-To
      to the sender's confirmed address (`EMAIL_REPLY_TO` is the fallback).
- [ ] Without `LLM_API_KEY` the brief page says no model is set up, criteria
      are typed by hand and every search runs on text only (shown on the page);
      with a key, proposals, hybrid retrieval and explanations record
      `ai_usage` rows of kinds `brief`, `embed` and `explain`.

## Legal

- [ ] Complete the publisher's identity and the contact address in
      `src/components/legal-page.tsx` (Contact sections).
- [ ] Sign the DPAs: Supabase, Cloudflare, Railway, Resend, the model vendor.
- [ ] Decide the default retention (24 months) and tell customers to inform
      candidates (the share page and the privacy policy already say a model is used).

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
