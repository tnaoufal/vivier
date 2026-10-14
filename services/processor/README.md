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
   as processed this month: `processed_at` stays null). When the other document was
   set aside (`rejected`, step 6), the copy is set aside too, with the same sentence,
   at no cost: a "processed" copy leading to no candidate would say nothing.
4. **Text**: the PDF's text layer (unpdf). A PDF with fewer than 150 readable characters
   per page on average (or in total) counts as scanned: with `MISTRAL_OCR_API_KEY` it
   goes through OCR (`extraction_method = 'ocr'`; the call asks for the images the OCR
   cut out, `include_image_base64`, kept for step 9 and stripped from the text);
   without, the document is `needs_ocr` with "Ce PDF est scanné : aucun texte lisible
   n'a été trouvé. Activez l'OCR ou saisissez la fiche à la main." Text is normalised
   (whitespace, control characters, `MAX_TEXT_CHARS`).
5. **Structuring**: with a model (`LLM_API_KEY`), one JSON completion under a prompt
   that extracts only what is written, answers null for what is not stated, gives a
   confidence per field and must not extract age, date of birth, gender, nationality or
   origin, photo, family status, health, religion, union or political data. The answer
   is validated with zod (one retry quoting the error). Without a model, a heuristic
   profile: email and phone by regex, a name from the first lines or the file name,
   low confidences, everything else empty (`structuring_method = 'heuristic'`).
   **Skills** are curated, not exhaustive: the prompt asks for the 8 to 20 skills that
   define the profile, from the most central to the least, as a recruiter would list
   them (domains of expertise, tools, methods, certifications; never document names,
   never generic words like "communication" unless the CV insists), and the processor
   keeps 24 at most (`MAX_SKILLS`, the first being the most central: the interface
   shows the first eight). A candidate read before this rule keeps the long list their
   row holds: the merge unions skills, it never trims them.
6. **Classification**, inside the same model call (no extra cost): the model says
   whether the text is one person's CV (`document_kind = 'cv'`: identity or contact
   details with experiences, education or skills) or something else (`'other'`: a cover
   letter alone, a diploma or certificate, an identity document, an invoice, a job
   offer, a brochure, a form, a list of several people, text that is not about a
   person). A document the model calls `other` is set aside: `status = 'rejected'`,
   `error` = "Ce document n'est pas un CV (lettre, diplôme, formulaire…) : il n'a pas
   été intégré au vivier.", the text, the page count and `processed_at` kept, and **no
   candidate is created or touched** (a document pinned to a candidate keeps its
   `candidate_id`). The person can re-queue it like a failed document if the model was
   wrong. Only an explicit `other` sets a document aside: a missing or unknown answer
   counts as a CV, and without a model nothing is ever rejected on content
   (`document_kind` stays null), because a doubt must never cost a person their place
   in the pool. The model's one-sentence reason is logged (`rejected`), never stored.
7. **Candidate**: the same person across different files is found in this order, the
   first hit wins: (a) the candidate the document was pinned to (uploaded from a
   profile page); (b) the email, case-insensitively (`findCandidateByEmail`, PostgREST
   `ilike` with the wildcards escaped: it filters the organisation's rows through the
   `org_id` index, a pattern cannot use the `lower(email)` one); (c) the phone number
   by its last nine digits (`candidates.phone_digits`, a column the database computes
   from `phone`, so "+33 6 12 34 56 78" and "06.12.34.56.78" meet; a suffix `like`,
   filtered the same way); (d) the fingerprint: the email, else name + phone digits,
   else name + the latest experience's company (or the first school), through its
   index. A name alone never merges. A contact detail alone does not merge two people
   either: an email, phone or fingerprint hit whose name disagrees with the CV's (both
   names full, two words or more, and not one word in common: "Jean Martin" vs "Marie
   Dupont"; "M. Dupont" vs "Marie Dupont" still meet) is refused, logged
   (`dedup_name_conflict`) and the next key is tried, so a CV sent through an agency
   or a family mailbox never gives one person another's background. Each lookup
   prefers an active candidate to an archived namesake, and when the only match is
   archived, the fresh CV puts the person back in the pool (`status = 'active'`,
   logged `candidate_reactivated`): a processed document must lead to a candidate a
   search can show. The lookup and the write run **one organisation at a time** (an
   in-process lock, `mutex.ts`): with several documents in flight, two exports of one
   CV uploaded together would otherwise both find nobody and both insert, and no
   database key refuses the second row. A new reading is merged into the candidate
   found (a value is kept unless it is empty or the new one is confident, ≥ 0.7 and at
   least as confident; skills and tags are unioned; lists are replaced when at least
   as confident; confidences keep the max), else a new row is inserted (`source =
   'upload'`, `created_by = documents.uploaded_by`). The fingerprint stored is the
   merged profile's. `search_text` feeds the full-text index; with a model,
   `embedding` (1024 dimensions) is computed from the merged profile's compact text
   once the row is written, outside the lock, and written in a second update. A failed
   embedding call never fails the document: it is logged (`embedding_mismatch` with
   the fix sentence when the model answered the wrong width, `embedding_failed`
   otherwise), the vector stays null and the hourly re-embed pass fills it in later.
8. **Document**: `processed`, `candidate_id`, `page_count`, `text_chars`,
   `extracted_text`, `extraction_method`, `structuring_method`, `document_kind`
   (`'cv'` with a model, null without), `processed_at`.
9. **Photo** (`photo.ts`, `png.ts`), outside the lock and never fatal: a candidate who
   already has a photo keeps it; one without gets the portrait of this CV's first page,
   when there is one. For a PDF with a text layer, the images drawn on page 1 are read
   with unpdf (`extractImages`, objects with width, height and channels since unpdf 0.12.2,
   the floor in `package.json`; the answer is checked at runtime: an unpdf of another
   signature means no photo and one `photo_images_unsupported` line naming the document,
   never a failure; an image over 1200x1200 px, which can never be the photo, is skipped
   by pdf.js before it is decoded, `maxImageSize`); the candidate photo is the largest
   image that looks like a portrait: both sides between 80 and 1200 px, width/height
   between 0.6 and 1.1, an area above 80x80, not drawn wider than half the page (the
   width it is drawn at, read from the page's operator list and its matrices, against
   the page's width in points: a scan of the page or a background is never taken for a
   face, a portrait kept at a high resolution is; when the drawn width cannot be read,
   this rule is skipped, never guessed); it is downscaled with a box filter to 256 px on
   its longest side and encoded as a PNG by the processor's own encoder (zlib, no
   dependency). For a scanned PDF, the OCR's first page is read instead: the largest
   image it cut out that fits the same rules (its bounding box against the page's
   width), stored as the OCR answered it, JPEG or PNG. The file goes to the private
   `photos` bucket at `<org_id>/<candidate_id>.png` (or `.jpg`), upserted, and its key
   to `candidates.photo_path`. The photo identifies a person in the interface and
   nothing else: it never enters a prompt, is never read for anything, and an
   organisation that practises anonymous CVs turns its display off
   (`organizations.show_photos`). A failure to read, encode or upload it is logged
   (`photo_read_failed`, `photo_write_failed`) and the document is processed all the
   same; `candidate_written` says whether a photo was written.

Any other error leaves the document `failed` with one sentence for the person ("Le
fichier n'a pas pu être lu.", "Le modèle n'a pas répondu." or "Le traitement a
échoué.") and the real cause in the log. Model, embedding and OCR spend is written to
`ai_usage` as it happens (`structure`, `embed`, `ocr`; for OCR, `tokens_in` holds the
pages processed, the unit Mistral bills).

### Statuses

`queued` → `processing` → `processed` | `rejected` | `needs_ocr` | `failed`. A person
can put a `failed`, `needs_ocr` or `rejected` document back to `queued` from the web
app. A `rejected` document counts as processed this month for the quota (the model was
called), not as a candidate. A document left in
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
| `LLM_EMBEDDING_MODEL` | no | `mistral-embed` on Mistral, else `text-embedding-3-small` | Must answer 1024 dimensions (OpenAI models are shortened to 1024). The service probes it at start: see "Embedding probe". |
| `MISTRAL_OCR_API_KEY` | no | | Enables OCR for scanned PDFs through `POST https://api.mistral.ai/v1/ocr`. |
| `MISTRAL_OCR_MODEL` | no | `mistral-ocr-latest` | OCR model. |
| `PORT` | no | `8080` | |
| `POLL_INTERVAL_MS` | no | `20000` | How often the queue is read. `0` disables polling (`POST /process` still works). |
| `MAINTENANCE_INTERVAL_MS` | no | `3600000` | How often the retention purge runs. `0` disables the timer (`POST /maintenance` still works). |
| `PROCESSOR_CONCURRENCY` | no | `4` | Documents processed at once, 1..8. A document mostly waits on the model and the storage, so four in flight drain a queue of hundreds of files at a steady pace; raise it on a larger container, lower it if the model's rate limit answers 429. |
| `MAX_TEXT_CHARS` | no | `200000` | Cap on the text kept per document. |

No value is ever logged or returned: `/health` and `/metrics` say which parts are set up,
not what they hold.

## Endpoints

| Route | Auth | Answer |
| --- | --- | --- |
| `GET /health` | none | `200 { ok: true, version, uptimeSeconds, supabase, model, ocr, embedding, polling }` as soon as the process listens. `embedding` is `"off"` without a model (and until the startup probe has answered), then `"ok"`, `"mismatch"` (the model answers the wrong width: set at once, kept until a call succeeds) or `"unavailable"` (the probe failed, or three calls in a row did, for another reason: one 429 or one timeout among the documents in flight does not flip it); it is read from memory, never from a call, so the route stays instant. |
| `GET /metrics` | bearer | Counters since start: documents by outcome (processed, failed, needsOcr, duplicates, quotaRefused, rejected, skipped), pages, model and OCR calls, purged candidates, last poll time, queue depth, documents in flight, the setup flags. |
| `POST /process` | bearer | `{ "documentIds": ["<uuid>", ...] }` (1..50, body ≤ 64 KiB). Schedules them without waiting; `202 { accepted }`. The web app calls it right after an upload so the person does not wait for the next poll. `503` without Supabase. |
| `POST /maintenance` | bearer | Runs the maintenance pass now and answers its report `{ ranAt, purged, filesRemoved, failed, staleRequeued, staleFailed, reembedded, reembedFailed, reembedSkipped, ms }`. `503` without Supabase. |

The bearer is compared in constant time. Every other path answers `401` without the
bearer and `404 { error }` with it; every error is `{ error: "<sentence>" }` without
internals.

## Maintenance pass

Every `MAINTENANCE_INTERVAL_MS` (and 30 s after start), in this order:

- **Stale reset**: documents left in `processing` for more than ten minutes go back to
  `queued`, or to `failed` past three attempts.
- **Retention purge**: `expired_candidates(100)` lists the candidates past their
  organisation's `retention_months` (counted from the last contact, else the upload)
  or whose consent is withdrawn. For each: the files of its documents are removed from
  the `cvs` bucket and its photo from the `photos` bucket (`photo_path`, and both keys
  a photo of the candidate can have, `.png` and `.jpg`, so one that no row names, from
  two CVs read at once, never outlives the person), then the candidate row is deleted
  (the cascade removes the document rows, the audit trigger logs `candidate.deleted`).
  A candidate whose files could not be removed is left for the next pass, so a row
  never outlives its files. The report's `filesRemoved` counts the photos with the
  CVs. (An erasure asked from a candidate's page is the web app's: it removes the CVs
  and the photo the row names before the row.)
- **Re-embed** (with a model only): up to 100 embedding calls per pass for the active
  candidates without a vector, most recently updated first (the
  `candidates_missing_embedding_idx` index), each from the candidate's compact profile
  text; each call is one `ai_usage` row of kind `embed` for the candidate's
  organisation. A profile with nothing to embed (no headline, summary, skills or
  positions: a heuristic profile) is skipped and stays where it is in the listing, so
  the pass reads the listing page by page (100 rows a page, 10 pages at most) until it
  has made its calls: a hundred such candidates at the top never hide the ones below
  them. The first wrong-width answer stops the pass (every other call would fail the
  same way): one `embedding_mismatch` log line carries the fix sentence, and `/health`
  says `"mismatch"` until a call succeeds. Any other failure is logged and the pass
  goes on. The report counts `reembedded`, `reembedFailed` and `reembedSkipped`; a
  pass that only skipped logs `reembed_skipped`, since its counts look healthy.

## Embedding probe

Right after the server listens, when a model is configured, the service embeds the
text "vivier probe" once (one tiny call, billed to no organisation) and logs
`embedding_ok { model, dimensions: 1024 }`, or `embedding_mismatch` with the sentence
that names `LLM_EMBEDDING_MODEL`, the width answered and the 1024 the schema holds, or
`embedding_unavailable` for any other error. `/health` shows the same state
(`embedding`), which the pipeline and the re-embed pass keep up to date afterwards: a
wrong width flips it to `"mismatch"` at once, a success puts it back to `"ok"`, and
three other failures in a row (not one) make it `"unavailable"`. The probe never
blocks `/health`: Railway's check and CI's smoke test read it at once. A `"mismatch"`
means every candidate processed since the model was set has no vector: fix the
variable, redeploy, and the hourly re-embed pass gives them one.

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
