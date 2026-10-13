# Architecture

What runs where, how the four main flows cross the pieces, which trust
boundary each piece sits behind, and what every secret unlocks. The
README says what the product does; this page says how the parts hold
together. Paths are relative to `vivier/`.

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
            │ Auth, Storage `cvs`,  │   │ polls documents, structures, │
            │ Realtime, pgvector    │   │ embeds, purges               │
            └───────────────────────┘   └──────────────────────────────┘
```

| Component | Code                                   | Runs as                                                        | Holds                                                                                   |
| --------- | -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser   | `src/routes`, `src/components`         | the signed-in person, under RLS                                | the publishable key (public), the session's access token (memory)                       |
| Worker    | `src/lib/*/*.functions.ts`, `src/routes/api/*` | Cloudflare Workers; service role after `requireMember()` | every secret of the web side (see "Secrets")                                            |
| Database  | `supabase/migrations`                  | Postgres with policies, triggers and SECURITY DEFINER helpers  | everything: one `org_id` on every row                                                   |
| Processor | `services/processor/src`               | one Node process on Railway, service role                      | the service role key, the model key, the OCR key, the shared secret                     |
| Resend    | `src/lib/email/email.server.ts`        | called by the Worker only                                      | nothing of ours beyond the emails sent                                                  |
| Model     | `src/lib/model/model.server.ts`, `services/processor/src/model.ts` | called by the Worker and the processor only  | the text it is sent (CV text, briefs, profiles) for the duration of the call            |

## Flows

### Upload: a CV becomes a profile

```
Browser (member)                 Supabase                          Processor
──────────────────               ────────────────────────          ─────────────────────────────
validate batch
  (PDF, 25 MB, 200 files)
hash file (SHA-256)
select documents                 RLS: org member
  where org_id, sha256  ──────▶  ─ same hash? tell the person
upload object           ──────▶  storage: cvs/<org>/<doc>.pdf
                                 (policy: member of <org>)
insert documents row    ──────▶  status = queued
                                 (policy: uploaded_by = me,
                                  storage_path LIKE '<org>/%')
                                 trigger: activity document.uploaded
notifyProcessor() ───▶ Worker ─▶ requireMember, rate limit ─▶ POST /process {documentIds}   (best effort)
                                                                 ─ or the poll, every 20 s ─
                                 queued → processing     ◀──────  claim (atomic on status)
                                 cvs_processed_this_month ◀─────  quota check (fail with a sentence when reached)
                                 download object          ◀─────  sha256 → documents.sha256
                                                                  (23505 on (org, sha256): attach to the
                                                                   existing candidate, processed, stop)
                                                                  text layer (unpdf) │ scanned?
                                                                    ├─ OCR key: Mistral OCR
                                                                    └─ none: needs_ocr + sentence
                                                                  structure: model JSON (zod) │ heuristics
                                                                  fingerprint → existing candidate? merge : insert
                                                                  search_text; embedding (best effort, 1024)
                                 candidates upsert        ◀─────
                                 documents processed      ◀─────  page_count, text_chars, methods, processed_at
                                 trigger: activity document.processed | failed | needs_ocr
Realtime (documents) ◀────────── change
list banner and profile page refresh
```

A member may send a `failed` or `needs_ocr` document back to `queued`
(`guard_document_update()` allows that transition only and clears
`error`); every other status is the processor's.

### Search: a brief against the pool

```
Browser (member)             Worker                                   Supabase                 Model
────────────────             ──────────────────────────────────       ───────────────────      ─────────────
runSearch({token, org,
  briefId})          ──────▶ requireMember(member)
                             enforceRateLimit("search")
                             load brief (service role, org filter) ─▶ briefs
                             queryTextOf(brief)                                           ──▶ embed (1024) │ none
                             rpc search_candidates(org, terms,
                               embedding | null, 80)              ─▶ full text (fts, simple, unaccent)
                                                                     ⊕ cosine over HNSW
                                                                     reciprocal rank fusion 1/(60+r)
                             select the profiles returned         ─▶ candidates (org filter, active)
                             scoreCandidate() per profile:
                               verdict per criterion + evidence
                               score over evaluable, coverage,
                               blocked when a required one is missing
                             rankResults()
                             explainTop(12)                                               ──▶ JSON {why} │ skipped
                             insert searches row                  ─▶ query, criteria, results, method, ran_by
                             return {results, criteria, method}
cards: verdict chips, "not stated", blocked named, why when a model answered
"add to shortlist"   ──────▶ (browser, RLS) shortlists (first use) + shortlist_items with the match snapshot
```

`search_candidates()` is SECURITY INVOKER: even called with the service
role, the Worker filters by the organisation it verified, and the browser
could call it directly only for the organisations it belongs to.

### Share: a shortlist to a hiring manager

```
Browser (member)               Worker                                      Supabase / Resend
──────────────────             ─────────────────────────────────────       ───────────────────────────────
createShare({token, org,
  shortlistId, title, intro,
  items, includeCvs, expiry}) ─▶ requireMember(member), enforceRateLimit("share")
                               load shortlist + retained candidates (org filter)
                               draft summaries with the model when configured (ai_usage: summary)
                               token = random bytes (base64url)
                               insert shares { token_hash = sha256(token), items snapshot, expires_at }
                               insert activities share.created
                               return { link: SITE_URL/share/<token> } ─ shown once; the raw token is never stored
team edits summaries,
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
                               render the snapshot; each CV button opens
                               GET /api/share/<token>/cv/<documentId>, which hashes the token again,
                               checks the share is active, includes CVs and carries that document,
                               then redirects to a 120-second signed URL (404 otherwise)
print to PDF from the browser
```

### Purge: retention and withdrawn consent

```
Processor (hourly, and POST /maintenance)          Supabase
──────────────────────────────────────────         ─────────────────────────────────────────────
expired_candidates(100)                  ────────▶ candidates past
                                                   coalesce(last_contact_at, created_at) + retention_months,
                                                   or consent_status = 'withdrawn'
for each:
  select documents.storage_path          ────────▶
  remove the objects from `cvs`          ────────▶ storage (missing objects are not an error)
  on failure: skip, leave for the next pass (a row never outlives its files)
  delete candidates row                  ────────▶ cascade: documents, shortlist_items, comments
                                                   trigger: activities candidate.deleted (name in payload)
stale reset (same pass): processing > 10 min → queued; after 3 claims → failed
```

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
   `queued`. Triggers stamp `decided_by`, log activities and keep the last
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
   first. An `AppError` reaches the browser as a code (`AUTH:required`,
   `ORG:forbidden`, `RATE:limited`, `SETUP:model`…) that `errorMessage()`
   turns into a sentence; never free text from the server.
3. **The processor.** Server-to-server only: every route but `GET /health`
   needs the bearer secret (compared on SHA-256 digests in constant time),
   no CORS, every answer JSON, every error a sentence. It holds the service
   role key and works on rows the database hands it (`documents` queued,
   `expired_candidates()`), naming the organisation of each row in every
   query. It writes the columns the browser may not.
4. **The public share page.** The only unauthenticated reader of
   organisation data. It receives a token, never an id; hashes it; reads
   one `shares` row by `token_hash` with the service role; refuses expired
   and revoked shares; serves the snapshot in the row (not the live
   profiles) and mints short signed URLs for the CVs it lists. It is rate
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
| `LLM_API_KEY` (with `LLM_BASE_URL`, models)           | The model vendor: structuring, embeddings, criteria, explanations, summaries                         | Cloudflare dashboard, Railway                                                               | git, the browser, `/status` (names only)   |
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
