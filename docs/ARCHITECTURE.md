# Architecture

What runs where, how the four main flows cross the pieces, which trust
boundary each piece sits behind, and what every secret unlocks. The
README says what the product does; this page says how the parts hold
together. Paths are relative to the repository root.

## Components

```
            ┌────────────────────────────┐
            │  Browser (React, TanStack) │  supabase-js under RLS, server functions with the access token
            └──────┬──────────────┬──────┘
                   │              │
   PostgREST/Auth/ │              │ server functions (POST), API routes
   Storage/Realtime│              ▼
                   │   ┌────────────────────────────┐        ┌──────────────┐
                   │   │ Worker (Cloudflare)        │──────▶ │ Resend       │  invitations, shared shortlists
                   │   │ src/lib/*/*.functions.ts   │        └──────────────┘
                   │   │ src/lib/platform/*.server  │──────▶ model vendor (OpenAI-compatible API)
                   │   └──────┬──────────────┬──────┘
                   │          │ service role │ bearer secret (POST /process)
                   ▼          ▼              ▼
            ┌───────────────────────┐   ┌──────────────────────────────┐
            │ Supabase (EU)         │◀──│ Processor (Railway, Node)    │──▶ model vendor, Mistral OCR
            │ Postgres 17 + RLS     │   │ services/processor           │
            │ Auth, Storage `cvs`,  │   │ polls documents, classifies, │
            │ Realtime, pgvector    │   │ structures, dedups, embeds,  │
            │                       │   │ re-embeds, purges            │
            └───────────────────────┘   └──────────────────────────────┘
```

| Component | Code                                   | Runs as                                                        | Holds                                                                                   |
| --------- | -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser   | `src/routes`, `src/components`         | the signed-in person, under RLS                                | the publishable key (public), the session's access token (memory)                       |
| Worker    | `src/lib/*/*.functions.ts`, `src/routes/api/*` | Cloudflare Workers; service role after `requireMember()` | every secret of the web side (see "Secrets")                                            |
| Database  | `supabase/migrations`                  | Postgres with policies, triggers and SECURITY DEFINER helpers  | everything: one `org_id` on every row                                                   |
| Processor | `services/processor/src`               | one Node process on Railway, service role                      | the service role key, the model key, the OCR key, the shared secret                     |
| Resend    | `src/lib/email/email.server.ts`        | called by the Worker only                                      | nothing of ours beyond the emails sent                                                  |
| Model     | `src/lib/model/model.server.ts`, `services/processor/src/model.ts` | called by the Worker and the processor only  | the text it is sent (CV text, briefs; for the assessment a profile without name, e-mail or phone) for the duration of the call |

## Flows

### Upload: a CV becomes a profile

```
Browser (member)                 Supabase                          Processor
──────────────────               ────────────────────────          ─────────────────────────────
validate the selection once
  (PDF, 25 MB, 10 000 files)
lots of 100; in a lot, three files at a time:
  hash file (SHA-256)
  select documents               RLS: org member
    where org_id, sha256 ──────▶ ─ same hash? "duplicate", stop
  upload object         ──────▶  storage: cvs/<org>/<doc>.pdf
                                 (policy: member of <org>)
  insert documents row  ──────▶  status = queued
                                 (policy: uploaded_by = me,
                                  storage_path LIKE '<org>/%')
                                 trigger: activity document.uploaded
after each lot:
notifyProcessor(ids) ─▶ Worker ─▶ requireMember, rate limit ─▶ POST /process {documentIds} ×50   (best effort)
"stop after this lot" │ "resume" │ "retry the failures"         ─ or the poll, every 20 s ─
                                 queued → processing     ◀──────  claim (atomic on status), 4 at a time
                                 cvs_processed_this_month ◀─────  quota check (fail with a sentence when reached)
                                 download object          ◀─────  sha256 → documents.sha256
                                                                  (23505 on (org, sha256): attach to the
                                                                   existing candidate, processed, stop;
                                                                   set aside too when the original was)
                                                                  text layer (unpdf) │ scanned?
                                                                    ├─ OCR key: Mistral OCR
                                                                    └─ none: needs_ocr + sentence
                                                                  structure + classify: model JSON (zod) │ heuristics
                                                                    └─ document_kind "other": rejected + sentence,
                                                                       text kept, no candidate touched, stop
                                                                  ┌ one organisation at a time (mutex.ts) ┐
                                                                  │ pinned? else email, else phone digits, │
                                                                  │ else fingerprint; a hit whose name     │
                                                                  │ disagrees is refused, next key tried   │
                                                                  │ found? merge (reactivate) : insert     │
                                                                  └ search_text, fingerprint ──────────────┘
                                 candidates upsert        ◀─────
                                 candidates.embedding     ◀─────  embedding (best effort, 1024, outside the lock)
                                 documents processed      ◀─────  page_count, text_chars, methods, document_kind, processed_at
                                 trigger: activity document.processed | rejected | failed | needs_ocr
Realtime (documents) ◀────────── change
list banner (failed, set aside) and profile page refresh
```

A member may send a `failed`, `needs_ocr` or `rejected` document back to
`queued` (`guard_document_update()` allows that transition only and clears
`error`); every other status is the processor's. The lots, the stop
between lots, the resume and the retry are the pure state machine of
`src/lib/candidates/upload.ts`, run by `upload-runner.ts` with every
outside effect injected.

### Analysis: a brief against the pool

```
Browser (member)             Worker                                   Supabase                 Model
────────────────             ──────────────────────────────────       ───────────────────      ─────────────
runSearch({token, org,
  briefId})          ──────▶ requireMember(member)
                             enforceRateLimit("search")
                             load brief (service role, org filter) ─▶ briefs
                             no criteria? derive them (a proposal)                        ──▶ JSON {criteria} │ skipped
                               saved into the brief                 ─▶ briefs.criteria
                             no role? derive it (label + definition)                      ──▶ JSON {label, value} │ the title
                               saved in front of the criteria        ─▶ briefs.criteria
                             count active candidates                ─▶ candidates (HEAD, count=exact)
                             ≤ 200: load the whole pool             ─▶ candidates (org filter, active)
                             > 200: queryTextOf(brief)                                    ──▶ embed (1024) │ none
                               rpc search_candidates(org, terms,
                                 embedding | null, 120)             ─▶ full text (fts, simple, unaccent)
                                                                       ⊕ cosine over HNSW
                                                                       reciprocal rank fusion 1/(60+r)
                               select the profiles returned         ─▶ candidates (org filter, active)
                             scoreCandidate() per profile:
                               verdict per criterion + evidence
                               (missing only with contradicting evidence)
                               score over evaluable, coverage,
                               blocked when a required one is missing
                             rankResults()
                             insert searches row                    ─▶ query, criteria, results, method, pool_size, ran_by
                             return {results, criteria, poolSize, criteriaDerived}
cards "not analysed"; the line says the pool's size and how many profiles were read
then, six at a time, until done or interrupted ("resume" sends what is left):
assessCandidates({token,
  org, briefId, searchId,
  candidateIds[≤6]})  ──────▶ requireMember(member)
                             enforceRateLimit("assess")
                             load brief, load search (org filter)   ─▶ briefs, searches
                             load the profiles (active)             ─▶ candidates
                             per candidate, in parallel:
                               assessmentPayload(): role apart, then
                                 requirements, fields + CV text,
                                 name / e-mail / phone redacted                           ──▶ JSON {requirements, decision,
                               enforceAssessment(): a row per                                 score, summary}
                                 criterion, no evidence → unknown,                            (LLM_ASSESSMENT_MODEL | LLM_MODEL)
                                 role "no" → no_fit, score ≤ 25,
                                 required "no" → no_fit, score ≤ 39, …
                               recordUsage("assess")                ─▶ ai_usage
                             re-read the row, write the entries     ─▶ searches.results (assessment per entry)
                             carry to unassessed shortlist items    ─▶ shortlist_items.match (+ criteria)
                             return {results, failed}
cards move to matching / to check / set aside (collapsed)
"add to shortlist"   ──────▶ (browser, RLS) shortlists (first use) + shortlist_items with the match snapshot
```

`search_candidates()` and `similar_candidates()` (the "similar profiles"
drawer of a profile page, which the browser calls directly) are SECURITY
INVOKER: even called with the service role, the Worker filters by the
organisation it verified, and the browser can call them only for the
organisations it belongs to.

The **role requirement** is the criterion of kind `role` a brief holds
once (`briefs.criteria`, `src/lib/briefs/criteria.ts`): the job as the
team names it, and its definition (the job's domain, core missions,
equivalent titles, sector when stated, written from what the job is in
the market), required and essential by default. The guard against
protected characteristics reads a role on its core list only, since a
job's domain is written with words ("famille de produits", "politique
commerciale") the wider list bans. The extraction proposes it first;
`runSearch` gives it to a brief that has none (one small call,
`roleDefinitionPrompt`, else the title; never a title that names a
protected characteristic, which the parser would drop on the next read)
and saves it in front of the other criteria, once. The assessment
payload names it apart (`brief.role`) and the system prompt judges it
before anything else, from what the person did before the titles, since
every company names a job differently: a CV full of other missions is a
`no` with those missions as evidence, not silence; the métier is judged
on the most recent and longest positions; a title without a description
is read for what it usually means. `enforceAssessment()` then binds the
answer on the role first: `no` forces `no_fit` and caps the score at 25
(`ROLE_NO_SCORE_CAP`), whatever the other requirements and whether or not
the team kept it required; `partial` caps the decision at `borderline` and
the score at 65 (`ROLE_PARTIAL_SCORE_CAP`); `unknown` at `borderline` and
60 (`ROLE_UNKNOWN_SCORE_CAP`). The deterministic pass only finds the role
in a title that carries the words of its name, never calls it missing.

### Share: a dossier to a hiring manager

```
Browser (member)               Worker                                      Supabase / Resend
──────────────────             ─────────────────────────────────────       ───────────────────────────────
draftShare({token, org,
  shortlistId, candidateIds,
  useModel})            ──────▶ requireMember(member)
                               load shortlist + brief, the candidates, their latest CV
                                 and their shortlist match (org filter)
                               one sheet per candidate (draft.ts): facts, requirement table
                                 (assessment, else verdicts), score, decision, synthesis,
                                 strengths / attention read off the table
                               with a model: rewrite the prose only (ai_usage: summary)
                               return { items, brief snapshot }
team edits the prose (table, score and decision are read-only),
createShare({token, org,
  shortlistId, title, intro,
  items, includeCvs, expiry}) ─▶ requireMember(member), enforceRateLimit("share")
                               re-verify every candidate and CV id (org filter)
                               brief = briefSnapshot(the shortlist's brief)   never from the browser
                               token = random bytes (base64url)
                               insert shares { token_hash = sha256(token), items, brief, expires_at }
                               insert activities share.created
                               return { link: SITE_URL/share/<token> } ─ shown once; the raw token is never stored
sends                  ──────▶ sendShare: requireMember, enforceRateLimit("email")
                               emailLayout(), sendRecorded()           ─▶ email_sends (queued → sent | failed), Resend
                               activities share.sent
revokes                ──────▶ revokeShare: revoked_at = now(), activities share.revoked

Hiring manager (no account)    Public share route (server)
──────────────────────────     ─────────────────────────────────────
GET /share/<token>     ──────▶ enforceRateLimit("share")
                               hash the token, select shares by token_hash (service role)
                               refuse when revoked_at is set or expires_at is past (and say which)
                               view_count + 1, last_viewed_at
                               render the snapshot (items and brief, guarded: a share stored before
                                 the dossier reads as sheets without a table, and says so); each CV button opens
                               GET /api/share/<token>/cv/<documentId>, which hashes the token again,
                               checks the share is active, includes CVs and carries that document,
                               then redirects to a 120-second signed URL (404 otherwise)
print to PDF from the browser (A4, one sheet per page)
```

### Maintenance: stale reset, retention, re-embed

```
Processor (hourly, 30 s after start, and POST /maintenance)   Supabase
───────────────────────────────────────────────────────────   ─────────────────────────────────────────────
stale reset: processing > 10 min → queued; after 3 claims → failed
expired_candidates(100)                  ────────▶ candidates past
                                                   coalesce(last_contact_at, created_at) + retention_months,
                                                   or consent_status = 'withdrawn'
for each:
  select documents.storage_path          ────────▶
  remove the objects from `cvs`          ────────▶ storage (missing objects are not an error)
  on failure: skip, leave for the next pass (a row never outlives its files)
  delete candidates row                  ────────▶ cascade: documents, shortlist_items, comments
                                                   trigger: activities candidate.deleted (name in payload)
re-embed (with a model):                 ◀──────── active candidates without a vector, newest first
  100 calls a pass, page by page past                (candidates_missing_embedding_idx)
  the profiles with nothing to embed,
  one ai_usage embed per call            ────────▶ candidates.embedding
  a wrong width stops the pass; /health says "mismatch"
```

At start, when a model is configured, the processor embeds one short
probe text and logs `embedding_ok`, `embedding_mismatch` (with the sentence
naming `LLM_EMBEDDING_MODEL`, the width answered and the 1024 the schema
holds) or `embedding_unavailable`; `GET /health` shows the same state
(`embedding`) without waiting for the probe, and the pipeline and the
re-embed pass keep it current. A document set aside or failed that is
pinned to no candidate is reached by neither pass: an administrator
deletes it through the API (no page does yet).

The same removal, on demand, is `eraseCandidate` (an administrator, from
the profile page): files first, then the row, then one log line naming
who erased and how many files.

## Trust boundaries

Four callers, four sets of rights. Each boundary is enforced by code that
runs beyond the caller's reach.

1. **The browser, under RLS.** It holds the publishable key and the
   person's access token. Every read and write goes through PostgREST
   with the token; the policies in the migration decide by
   `memberships.role` (`org_role()`, `has_org_role()`, SECURITY DEFINER so
   the membership table itself never recurses). Column grants narrow the
   writes further: the browser cannot set `documents.error` or the processing
   result columns, `candidates.fingerprint` / `search_text` / `embedding` /
   `confidence`, `organizations.plan` / `seat_limit` / `cv_quota_month`,
   cannot insert `shares`, `email_sends`, `activities`, `ai_usage`,
   `invitations` or `memberships`, and only moves a document back to
   `queued` (from `failed`, `needs_ocr` or `rejected`). `candidates.phone_digits`
   is computed by the database and written by nobody; `shares.brief` and
   the assessment in `searches.results` are written by the Worker alone
   (a member inserts a shortlist item's match, never updates one; the
   Worker fills only an unassessed one). Triggers stamp `decided_by`, log activities and keep the last
   owner. Supabase's default privileges (every new table granted to `anon`
   and `authenticated`) are revoked at the top of the migration, so the
   grants written in it are the whole truth. `anon` has no grant on any
   table or function. Storage: a folder
   per organisation, read by members, written by members, deleted by
   admins.
2. **The Worker's server functions.** They receive the access token in
   the call's data and nothing else about the caller. `requireMember()`
   verifies the token with Auth (cached five minutes, bounded by the JWT's
   expiry), reads the role from `memberships` with the service role and
   refuses below the minimum. Only then does the handler use `db()` (the
   service role, which bypasses RLS), and every query it runs names the
   organisation it verified. Costly handlers call `enforceRateLimit()`
   first (one scope each: `model`, `search`, `assess`, `share`, `email`,
   `processor`). What leaves for the model is built by pure, tested
   modules: the assessment payload carries no name, e-mail or phone
   (`redactIdentity()`), and the answer is bound by rules before it is
   stored (`enforceAssessment()`). An `AppError` reaches the browser as a code (`AUTH:required`,
   `ORG:forbidden`, `RATE:limited`, `SETUP:model`…) that `errorMessage()`
   turns into a sentence; never free text from the server.
3. **The processor.** Server-to-server only: every route but `GET /health`
   needs the bearer secret (compared on SHA-256 digests in constant time),
   no CORS, every answer JSON, every error a sentence. It holds the service
   role key and works on rows the database hands it (`documents` queued,
   `expired_candidates()`, the candidates without a vector), naming the
   organisation of each row in every query. It writes the columns the
   browser may not, and serialises the candidate lookup and write per
   organisation in process (one instance on Railway; a second one would
   need a database key).
4. **The public share page.** The only unauthenticated reader of
   organisation data. It receives a token, never an id; hashes it; reads
   one `shares` row by `token_hash` with the service role; refuses expired
   and revoked shares; serves the snapshot in the row (the sheets and the
   brief's snapshot, not the live profiles or the live brief) and mints
   short signed URLs for the CVs it lists. It is rate
   limited by address so a token cannot be guessed at speed; tokens are
   random bytes, hashed at rest, so a database read does not reveal a
   link.

Secrets never cross a boundary downward: the browser bundle holds the
publishable key only (Vite's import protection refuses any `server/`
import on the client), `/status` and `/health` answer booleans and public
names, log lines carry event names, ids and the start of an error message,
never a body, a key or a token.

## Secrets: what each unlocks, where it lives

| Secret                                                | Unlocks                                                                                              | Lives in                                                                                   | Never in                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `SUPABASE_SERVICE_ROLE_KEY`                           | Every row of every organisation, storage signing and removal, the SECURITY DEFINER functions reserved to it (`expired_candidates`, `sync_plan_from_billing`) | Cloudflare dashboard (Worker), Railway (processor), `scripts/backup.sh` never (it uses the database URL) | the browser, git, `/status`, logs          |
| `PROCESSOR_SHARED_SECRET`                             | `POST /process`, `POST /maintenance`, `GET /metrics` on the processor                                | Cloudflare dashboard and Railway (the same value, 32+ characters)                           | git, the browser, health answers           |
| `LLM_API_KEY` (with `LLM_BASE_URL`, models, `LLM_ASSESSMENT_MODEL` on the Worker) | The model vendor: structuring and classification, embeddings, criteria, assessments, dossier drafts | Cloudflare dashboard, Railway                                                     | git, the browser, `/status` (names only)   |
| `MISTRAL_OCR_API_KEY`                                 | OCR of scanned PDFs                                                                                  | Railway                                                                                     | the Worker, git                            |
| `RESEND_API_KEY`                                      | Sending email (invitations, shares)                                                                  | Cloudflare dashboard                                                                        | git, the processor, the browser            |
| Supabase Auth secrets (JWT secret, OAuth client)      | Issuing and verifying sessions                                                                       | Supabase only; the Worker verifies tokens through Auth's `/user`, it never holds the JWT secret | anywhere of ours                        |
| Share tokens, invitation tokens                       | One share page, one invitation                                                                       | The link only (shown once); SHA-256 in `shares.token_hash` / `invitations.token_hash`       | the database in clear, logs, activities    |
| Backup credentials (`VIVIER_DATABASE_URL`, R2 and Supabase S3 keys) | Reading the whole database and bucket, writing the backup bucket                       | GitHub Actions secrets (`docs/BACKUPS.md`)                                                  | git, any service of the product            |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                       | Nothing on its own: the browser's identity to PostgREST, gated entirely by RLS                      | `.env`, the build; public by design                                                         | (not a secret)                             |

Rotation: the service role key and the shared secret can be rotated at
any time by setting the new value on both sides and redeploying; share and
invitation tokens die with their rows (`revoked_at`, expiry, deletion);
the backup credentials are rotated in the two dashboards and in GitHub.
