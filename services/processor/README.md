# Vivier processor

The processor turns the CVs HR teams upload into structured candidates. The web app puts
a PDF in the private `cvs` bucket (`<org_id>/<document_id>.pdf`) and inserts a row in
`public.documents` with `status = 'queued'`; this service, on Railway with the Supabase
service role key, takes each queued document, reads it, structures it and writes a
`public.candidates` row. It also runs the retention purge.

It is a plain Node 22 + Fastify 5 service in TypeScript (`src/`), with no state of its
own: everything lives in Supabase; the counters on `/metrics` are in memory since the
process started.

## What it does, in order

1. **Claim**: `documents` row `queued` → `processing`, `attempts + 1`, atomically (a second
   processor asking for the same document gets nothing).
2. **Quota**: `cvs_processed_this_month(org) >= organizations.cv_quota_month` → the
   document is `failed` with "Quota mensuel de CV atteint. Il se renouvelle le 1er du
   mois." and the attempt is not counted. Nothing is downloaded or spent.
3. **Download and sha256**: the file's SHA-256 is written to `documents.sha256`. The
   unique index on `(org_id, sha256)` refuses a file the organisation already has: the
   document is then attached to the other document's candidate, `processed`,
   `extraction_method = 'none'`, and stops (a duplicate costs nothing and is not counted
   as processed this month: `processed_at` stays null).
4. **Text**: the PDF's text layer (unpdf). A PDF with fewer than 150 readable characters
   per page on average (or in total) counts as scanned: with `MISTRAL_OCR_API_KEY` it
   goes through OCR (`extraction_method = 'ocr'`); without, the document is
   `needs_ocr` with "Ce PDF est scanné : aucun texte lisible n'a été trouvé. Activez
   l'OCR ou saisissez la fiche à la main." Text is normalised (whitespace, control
   characters, `MAX_TEXT_CHARS`).
5. **Structuring**: with a model (`LLM_API_KEY`), one JSON completion under a prompt
   that extracts only what is written, answers null for what is not stated, gives a
   confidence per field and must not extract age, date of birth, gender, nationality or
   origin, photo, family status, health, religion, union or political data. The answer
   is validated with zod (one retry quoting the error). Without a model, a heuristic
   profile: email and phone by regex, a name from the first lines or the file name,
   low confidences, everything else empty (`structuring_method = 'heuristic'`).
6. **Candidate**: the fingerprint (email, else name + phone digits) finds an existing
   candidate of the organisation; a new reading is merged into it (a value is kept
   unless it is empty or the new one is confident, ≥ 0.7 and at least as confident;
   skills and tags are unioned; lists are replaced when at least as confident;
   confidences keep the max) or a new row is inserted (`source = 'upload'`,
   `created_by = documents.uploaded_by`). `search_text` feeds the full-text index; with
   a model, `embedding` (1024 dimensions) is computed from a compact text. A failed
   embedding call never fails the document: it is logged and the vector stays null.
7. **Document**: `processed`, `candidate_id`, `page_count`, `text_chars`,
   `extracted_text`, `extraction_method`, `structuring_method`, `processed_at`.

Any other error leaves the document `failed` with one sentence for the person ("Le
fichier n'a pas pu être lu.", "Le modèle n'a pas répondu." or "Le traitement a
échoué.") and the real cause in the log. Model, embedding and OCR spend is written to
`ai_usage` as it happens (`structure`, `embed`, `ocr`; for OCR, `tokens_in` holds the
pages processed, the unit Mistral bills).

### Statuses

`queued` → `processing` → `processed` | `needs_ocr` | `failed`. A person can put a
`failed` or `needs_ocr` document back to `queued` from the web app. A document left in
`processing` for more than ten minutes (a crash, a redeploy) is put back to `queued` by
the next poll, unless it has already been claimed three times: it is then left `failed`
("Le traitement a échoué."), so a document that crashes the process cannot loop.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PROCESSOR_SHARED_SECRET` | yes | | Bearer secret for every route but `/health`; the same value as `PROCESSOR_SHARED_SECRET` on the Worker. At least 32 characters (`openssl rand -hex 32`) or the process refuses to start. |
| `PROCESSOR_ALLOW_INSECURE_SECRET` | no | | `1` accepts a shorter secret. CI's smoke test only. |
| `SUPABASE_URL` | for work | | Project URL. Without it (and the key) the service answers `/health` only. |
| `SUPABASE_SERVICE_ROLE_KEY` | for work | | Service role key (bypasses RLS). |
| `LLM_API_KEY` | no | | Enables the model. Without it: no-model mode (heuristic profiles, no embeddings). |
| `LLM_BASE_URL` | no | `https://api.openai.com/v1` | Any OpenAI-compatible API, e.g. `https://api.mistral.ai/v1`. |
| `LLM_MODEL` | no | `mistral-small-latest` on Mistral, else `gpt-4o-mini` | Chat model. |
| `LLM_EMBEDDING_MODEL` | no | `mistral-embed` on Mistral, else `text-embedding-3-small` | Must answer 1024 dimensions (OpenAI models are shortened to 1024). |
| `MISTRAL_OCR_API_KEY` | no | | Enables OCR for scanned PDFs through `POST https://api.mistral.ai/v1/ocr`. |
| `MISTRAL_OCR_MODEL` | no | `mistral-ocr-latest` | OCR model. |
| `PORT` | no | `8080` | |
| `POLL_INTERVAL_MS` | no | `20000` | How often the queue is read. `0` disables polling (`POST /process` still works). |
| `MAINTENANCE_INTERVAL_MS` | no | `3600000` | How often the retention purge runs. `0` disables the timer (`POST /maintenance` still works). |
| `PROCESSOR_CONCURRENCY` | no | `2` | Documents processed at once, 1..8. |
| `MAX_TEXT_CHARS` | no | `200000` | Cap on the text kept per document. |

No value is ever logged or returned: `/health` and `/metrics` say which parts are set up,
not what they hold.

## Endpoints

| Route | Auth | Answer |
| --- | --- | --- |
| `GET /health` | none | `200 { ok: true, version, uptimeSeconds, supabase, model, ocr, polling }` as soon as the process listens. |
| `GET /metrics` | bearer | Counters since start: documents by outcome (processed, failed, needsOcr, duplicates, quotaRefused, skipped), pages, model and OCR calls, purged candidates, last poll time, queue depth, documents in flight, the setup flags. |
| `POST /process` | bearer | `{ "documentIds": ["<uuid>", ...] }` (1..50, body ≤ 64 KiB). Schedules them without waiting; `202 { accepted }`. The web app calls it right after an upload so the person does not wait for the next poll. `503` without Supabase. |
| `POST /maintenance` | bearer | Runs the maintenance pass now and answers its report `{ ranAt, purged, filesRemoved, failed, staleRequeued, staleFailed, ms }`. `503` without Supabase. |

The bearer is compared in constant time. Every other path answers `401` without the
bearer and `404 { error }` with it; every error is `{ error: "<sentence>" }` without
internals.

## Retention purge

Every `MAINTENANCE_INTERVAL_MS` (and 30 s after start), `expired_candidates(100)` lists the
candidates past their organisation's `retention_months` (counted from the last contact,
else the upload) or whose consent is withdrawn. For each: the files of its documents are
removed from the `cvs` bucket, then the candidate row is deleted (the cascade removes the
document rows, the audit trigger logs `candidate.deleted`). A candidate whose files could
not be removed is left for the next pass, so a row never outlives its files.

## Running locally

```sh
cd vivier/services/processor
npm install            # generates package-lock.json the first time: commit it
cp .env.example .env   # fill PROCESSOR_SHARED_SECRET at least
npm run dev            # tsx watch src/server.ts, reads .env through your shell (e.g. `set -a; . ./.env; set +a`)
npm test
npm run typecheck
npm run build && npm start
```

There is no `package-lock.json` in the repository yet: it has to be generated and
committed by the first person with network access (`npm install`, then commit the
lockfile). Until then CI and the Dockerfile install from the ranges in `package.json`;
once the lockfile is there, switch the Dockerfile's two `npm install` lines to `npm ci`.

Production image, from the repository root:

```sh
docker build -f vivier/services/processor/Dockerfile -t vivier-processor:ci vivier
docker run --rm -p 8080:8080 -e PROCESSOR_SHARED_SECRET=ci -e PROCESSOR_ALLOW_INSECURE_SECRET=1 vivier-processor:ci
curl -s http://127.0.0.1:8080/health
```

## Railway

- Service from this repository, **root directory** `vivier`, **Dockerfile path**
  `services/processor/Dockerfile` (watch paths `services/processor/**`).
- **Health check** `/health`; the process answers it as soon as it listens.
- **Variables**: `PROCESSOR_SHARED_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  and when wanted `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`,
  `MISTRAL_OCR_API_KEY`. `PORT` is set by Railway.
- On the Worker (Cloudflare dashboard): `PROCESSOR_URL` (the service's public URL) and
  the same `PROCESSOR_SHARED_SECRET`.
- A stop sends SIGTERM: the poller stops, the server closes, the documents in flight get
  up to 25 s, then the process exits 0. What did not finish goes back to the queue within
  ten minutes.
