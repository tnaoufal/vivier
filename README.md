# Vivier

Vivier is the collaborative talent pool for HR teams: upload the CVs you
receive, let a model read them into structured profiles, match the pool to
a brief with every verdict explained, build a shortlist as a team (status,
votes, comments, assignment, decision trace) and share it by email as a
clean page the hiring manager can print. Every decision is a person's,
every page says what it knows and what it does not, and each organisation
sets how long its candidates are kept.

- **Product name**: "Vivier" (a vivier is where talent grows). Name, tagline
  and description live in `src/lib/brand.ts`; the mark is drawn inline in
  `src/components/brand-mark.tsx`. The interface speaks French and English
  (`src/lib/i18n`, one dictionary per feature, `en` must carry every key of
  `fr`, tested).
- **Fonts**: Geist, Geist Mono and Poppins 600, self-hosted from
  `public/fonts/` under the SIL Open Font License. No third-party stylesheet.
- **Where it lives**: inside `brand-genesis-studio` under `vivier/` until it
  moves to its own repository (see "Moving to a dedicated repository").
  Every path below is relative to `vivier/`.

## Principles

These four rules are enforced in the schema, the server functions and the
pages, not only promised:

- **No machine decision.** The model structures CVs, proposes criteria from
  a brief, ranks and explains. A person retains or dismisses, and the
  database stamps `shortlist_items.decided_by` / `decided_at` from the
  caller's session (`stamp_shortlist_decision()` trigger), never from the
  browser or the model. The UI shows who decided and when.
- **`not_stated` is never a mismatch.** A criterion the CV says nothing
  about is `not_stated`: it is excluded from the score and the coverage says
  how many criteria could be evaluated. A field the structuring did not read
  is absent (and shown as "not stated"), never invented.
- **No sensitive inference.** Age, date of birth, gender, nationality or
  origin, photo, family situation, health, religion, union membership and
  political opinions are never extracted, stored or used as criteria. The
  structuring prompt forbids them, the criteria extraction drops any such
  request and says so (`protectedCriterion()`), the explanation prompt may
  not mention them.
- **Honest pages.** A document that failed says why in one sentence
  (`documents.error`, written by the processor only), a search run without
  a model says it ran on text alone (`searches.method = 'text'`), a share
  says when it expires, a count that could not be read shows a dash, and
  `/status` shows what is set up without a single value.

## Architecture

| Layer     | Where                                       | Notes                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | `src/`                                      | TanStack Start (React 19, file-based routes in `src/routes`), Tailwind v4, shadcn/ui primitives in `src/components/ui`. Server functions in `src/lib/<feature>/<feature>.functions.ts`; server-only modules end in `.server.ts` and live in `src/lib/platform`.           |
| Hosting   | Cloudflare Workers (`wrangler.jsonc`)       | Nitro `cloudflare-module` preset. Every push to `main` deploys through Cloudflare's Git integration (root directory `vivier`); CI never deploys. `keep_vars` protects the dashboard's variables; the `VIVIER_RATE_LIMITER` binding throttles the costly server functions. |
| Data      | Supabase (`supabase/migrations`)            | Postgres 17 with Row Level Security on every table, Auth (email + Google), Storage (the private bucket `cvs`, PDF only, 25 MB), Realtime on the collaborative tables, pgvector (HNSW, cosine) for hybrid search. EU region.                                               |
| Processor | `services/processor`                        | Node 22 + Fastify 5 on Railway with the service role key: reads queued PDFs, structures them (model or heuristics), computes embeddings, deduplicates, and runs the hourly retention purge. Documented in `services/processor/README.md`.                                 |
| Email     | `src/lib/email/email.server.ts`             | Resend, transactional only (invitations, shared shortlists). Every send is a row in `email_sends`.                                                                                                                                                                        |
| Billing   | `src/lib/db/types.ts` (`Plan`), `plan-card` | Paddle, later: the plan grid and `sync_plan_from_billing()` exist, the checkout and the webhook do not (see "Not built yet").                                                                                                                                             |

The components, the flows and the trust boundaries are drawn in
`docs/ARCHITECTURE.md`.

## Getting started

Requirements: Bun 1.3.9 and Node 22. Dependencies are locked: `bun.lock` is
frozen and adding a package is an owner decision.

```sh
bun install --frozen-lockfile
cp .env.example .env     # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (public values)
bun run dev              # http://localhost:5173
```

The Supabase project: create one (EU region), apply
`supabase/migrations/20261013090000_vivier_init.sql` (`supabase link` then
`supabase db push`, or the SQL editor), enable Email and Google in Auth and
add `http://localhost:5173/**` to the redirect allow list. The migration
creates the schema, the policies, the `cvs` bucket, the functions and the
realtime publication; nothing is set up by hand in the dashboard beyond
Auth and the secrets.

Secrets for local server functions go in `.dev.vars` (wrangler) or your
shell, never in `.env` (CI refuses a committed env file holding a key).
Without a model key the app runs end to end in no-model mode and says so;
without the processor, uploads stay `queued`; without Resend, an invitation
shows its link to the inviter instead of emailing it.

The processor, in a second terminal:

```sh
cd services/processor
npm install              # generates package-lock.json the first time: commit it
cp .env.example .env     # PROCESSOR_SHARED_SECRET at least (openssl rand -hex 32)
set -a; . ./.env; set +a
npm run dev
```

### Scripts

Frontend (from `vivier/`):

| Command             | What it does                                                                      |
| ------------------- | --------------------------------------------------------------------------------- |
| `bun run dev`       | Vite dev server with SSR.                                                         |
| `bun run build`     | Production build (Nitro, Cloudflare module preset); generates `src/routeTree.gen.ts`. |
| `bun run build:dev` | The same build in development mode.                                               |
| `bun run preview`   | Serves the build locally.                                                         |
| `bun run test`      | Vitest unit tests (node environment; component tests opt into jsdom).             |
| `bun run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). |
| `bun run lint`      | ESLint (Prettier is enforced through ESLint).                                     |
| `bun run format`    | Prettier on the whole directory.                                                  |

Processor (from `services/processor`):

| Command             | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm run dev`       | `tsx watch src/server.ts`.                                        |
| `npm run build`     | `tsc` to `dist/`.                                                 |
| `npm start`         | `node dist/src/server.js`.                                        |
| `npm test`          | Vitest (an in-memory database and fake extractors; no network).   |
| `npm run typecheck` | `tsc --noEmit`.                                                   |

Backups: `scripts/backup.sh` (see "Backups").

### Environment variables

Worker (set in the Cloudflare dashboard, never committed; `/status` shows
which are present):

| Variable                                                                 | Purpose                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                                               | The public `https://` origin, used in every link an email carries (invitations, shared shortlists). Required for sending; the request's own origin is never trusted for a link.                                                                                                                                           |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`                     | The Supabase project the browser talks to under RLS. Public values, build-time (`.env` locally; the dashboard for the Git integration build). The server reads the same values, or `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` at runtime when the build did not carry them.                                                |
| `SUPABASE_SERVICE_ROLE_KEY`                                              | Secret. Bypasses RLS: used only by `db()` in `src/lib/platform/supabase.server.ts` after `requireMember()` verified the caller. Never in the browser.                                                                                                                                                                      |
| `PROCESSOR_URL`, `PROCESSOR_SHARED_SECRET`                               | The processor's public URL on Railway (a variable, empty in `wrangler.jsonc` until the service is deployed) and the bearer secret it expects (at least 32 characters, the same value on both sides). Used to poke the queue after an upload; the processor polls anyway.                                                     |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`        | The model (see "Model"): any OpenAI-compatible endpoint, its key, the chat model and the embedding model. Without `LLM_API_KEY` the app runs in no-model mode. The same four values go to the processor.                                                                                                                   |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`                         | Resend (see "Email"): the key (sending is off without it), the sender (`Vivier <hello@vivier.app>` by default; the domain must be verified on Resend), the reply-to (none by default).                                                                                                                                      |
| `VIVIER_RATE_LIMIT`                                                      | `off` disables the per-client throttle (development only). Inside Workers the `VIVIER_RATE_LIMITER` binding counts 60 calls per minute per scope; elsewhere an in-memory window applies the same policy.                                                                                                                   |

Processor (set on the Railway service; `/health` shows which parts are on):

| Variable                                                                 | Required | Purpose                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROCESSOR_SHARED_SECRET`                                                | yes      | Bearer secret for every route but `GET /health`; at least 32 characters or the process refuses to start (`PROCESSOR_ALLOW_INSECURE_SECRET=1` overrides for CI's smoke test only).                     |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                              | for work | The project and its service role key. Without them the service answers `/health` only.                                                                                                                |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`        | no       | The model, as on the Worker. Without the key: heuristic profiles, no embeddings.                                                                                                                      |
| `MISTRAL_OCR_API_KEY` (`MISTRAL_OCR_MODEL`, `MISTRAL_OCR_URL`)           | no       | OCR for scanned PDFs through Mistral's OCR API. Without it, scanned PDFs end in `needs_ocr`.                                                                                                          |
| `PORT`                                                                   | no       | `8080`; Railway sets it.                                                                                                                                                                              |
| `POLL_INTERVAL_MS`                                                       | no       | How often the queue is read (`20000`; `0` disables polling, `POST /process` still works).                                                                                                             |
| `MAINTENANCE_INTERVAL_MS`                                                | no       | How often the retention purge runs (`3600000`, one hour; `0` disables the timer).                                                                                                                     |
| `PROCESSOR_CONCURRENCY`                                                  | no       | Documents processed at once, 1..8 (`2`).                                                                                                                                                              |
| `MAX_TEXT_CHARS`                                                         | no       | Cap on the text kept per document (`200000`).                                                                                                                                                         |

No value is ever logged or returned by either service.

## Accounts and roles

Sign-in is Supabase Auth (email + password with confirmation, Google). A
profile row follows each account (`profiles`, created by trigger: email,
display name, language). A person belongs to organisations through
`memberships.role`; the first screen without one creates an organisation
(`create_organization()`, the caller becomes its owner) or follows an
invitation link. The current organisation is remembered in the browser;
`useOrg()` gives every page `org.id` and `can(role)`.

Access is decided by the role, in the database (RLS policies and column
grants in the migration) and again in server functions by
`requireMember(accessToken, orgId, minRole)`, which reads the caller from
the access token the browser sends and from nothing else. What each role
may do:

| Action                                                                                          | viewer | member | admin | owner |
| ----------------------------------------------------------------------------------------------- | :----: | :----: | :---: | :---: |
| Read candidates, documents, briefs, searches, shortlists, comments, votes, activity, shares     |   x    |   x    |   x   |   x   |
| Upload CVs, add or correct a candidate, archive, set consent, put a failed document back in the queue |        |   x    |   x   |   x   |
| Create and edit briefs, ask the model for criteria, run searches                                 |        |   x    |   x   |   x   |
| Add to a shortlist, retain or dismiss, assign, vote, comment (edit own comments), share and send |        |   x    |   x   |   x   |
| Delete candidates, documents and briefs, erase a candidate with their files, delete any comment  |        |        |   x   |   x   |
| Invite, revoke invitations, change roles below owner, remove members                             |        |        |   x   |   x   |
| Organisation settings (name, working language, retention), read model usage                     |        |        |   x   |   x   |
| Name or demote owners, delete the organisation                                                   |        |        |       |   x   |

Anyone may leave an organisation; the database keeps the last owner
(`keep_last_owner()` trigger, `ORG:last_owner`). A person deletes their own
account with `delete_my_account()`: organisations they own alone go with it.

Invitations (`/app/members`, administrators): an address and a role. The
server function mints a random token, stores its SHA-256 only
(`invitations.token_hash`), writes the row with the service role, logs
`member.invited` and emails the link through Resend when it is set up;
otherwise the link is shown once to the inviter to pass on. The link
(`/invite/<token>`) shows the organisation and the role before sign-in;
accepting runs `accept_invitation()`, which checks the digest, the seven-day
expiry, that the link was not used and that the invited address matches the
account's. Seats: `seats_used()` counts members plus pending invitations
against `organizations.seat_limit`.

Plans (`organizations.plan`): `trial` (3 seats, 200 CVs a month), `team`
(10, 1 000), `business` (50, 5 000). A plan is only ever set by
`sync_plan_from_billing()` with the service role; the browser cannot update
it (no column grant). The plan card on the settings page is read-only.

## The talent pool

How a CV becomes a profile:

1. **Upload** (`/app/candidates`, members): the browser validates the batch
   (PDF, 25 MB each, 200 files), then for each file, three at a time, hashes
   it (SHA-256, Web Crypto), looks for the same hash in the organisation,
   uploads the object to the private bucket at `<org_id>/<document_id>.pdf`
   and inserts a `documents` row with `status = 'queued'` (`uploaded_by`
   must be the caller; RLS checks it and the folder). The dialog then asks
   the server to poke the processor (`notifyProcessor`, rate-limited); the
   processor polls the queue every 20 s anyway, so a missed poke only delays
   the work and is never shown as an upload error.
2. **Processing** (the processor, with the service role): claims the row
   (`queued` → `processing`, atomically), checks the organisation's monthly
   quota (`cvs_processed_this_month()` against `cv_quota_month`), downloads
   the file, writes its SHA-256, reads the text layer, structures it, writes
   or merges the candidate, then marks the document `processed` with
   `page_count`, `text_chars`, `extracted_text`, `extraction_method`
   (`pdf-text`, `ocr`, `none`) and `structuring_method` (`model`,
   `heuristic`).
3. **Outcomes**: `processed`, `failed` (one French sentence in
   `documents.error`: unreadable file, model did not answer, processing
   failed, monthly quota reached) or `needs_ocr` (a scanned PDF and no OCR
   key). A member can put a `failed` or `needs_ocr` document back to
   `queued` from the profile page or the banner above the list; it is the
   only status change the browser may make (`guard_document_update()`
   trigger). A document left in `processing` for ten minutes is re-queued;
   after three claims it is left `failed` so a crashing file cannot loop.

Dedup, twice: the unique index on `documents (org_id, sha256)` refuses a
file the organisation already has (the duplicate document is attached to
the existing candidate, costs nothing and is not counted against the
quota); and the candidate **fingerprint** (the email, else name + phone
digits) finds an existing profile, into which the new reading is merged
(a value is kept unless it is empty or the new one is confident, ≥ 0.7 and
at least as confident; skills and tags are unioned; confidences keep the
max). A candidate can also be typed in by hand (`source = 'manual'`,
members).

Confidence per field: the structuring returns a 0..1 confidence for each
field it read (`candidates.confidence`). The profile page shows "to check"
or "uncertain" next to a field accordingly, never a verdict on the person;
a missing key means the field was not read and is shown as "not stated".

No-model mode: without `LLM_API_KEY` the processor still runs: an email
and a phone by regex, a name from the first lines or the file name, low
confidence on each, every other field empty, no embedding
(`structuring_method = 'heuristic'`). The list shows such rows as "to
check".

OCR: a PDF with fewer than 150 readable characters per page counts as
scanned. With `MISTRAL_OCR_API_KEY` it goes through Mistral's OCR API
(20 MB, 90 s; pages are recorded in `ai_usage` as kind `ocr`); without,
`needs_ocr` and a sentence telling the person to enable OCR or type the
profile in.

The profile page (`/app/candidates/:id`) shows what was read, with a form
to correct it (the browser may update the human-readable columns;
`fingerprint`, `search_text`, `embedding` and `confidence` are the
processor's), the CVs behind it (opened through a five-minute signed link),
the team's comments, consent and retention, archive, export and erasure.
Lists are live through Realtime on `documents` and `comments`.

## Briefs and search

A brief (`/app/briefs/new`) is a title and free text. Its **criteria** are
rows of `briefs.criteria`: a kind (`skill`, `experience`, `language`,
`location`, `education`, `availability`, `other`), a label (what the chip
says), a value (what is looked for), `required`, and a weight 1..3. With a
model, `extractCriteria` proposes up to twelve from the text; the person
adds the ones they keep, one by one or all at once, and nothing reaches
the brief without their gesture. A proposal naming a protected
characteristic is dropped and counted; the model's own warnings about
requests it refused are shown. Without a model, one sentence says so and
the criteria are typed in.

A **search** (`runSearch`, members, rate-limited) runs in three steps:

1. **Retrieval** in the database (`search_candidates()`, SECURITY INVOKER
   so the caller's RLS applies): full text over `candidates.fts`
   (unaccented, `simple` dictionary so French and English both work,
   `websearch_to_tsquery`) and, when the brief could be embedded, cosine
   similarity over the HNSW index, fused by **reciprocal rank fusion**
   (`1/(60 + rank)` from each list), the top 80 returned with both ranks.
   `searches.method` records `hybrid` or `text`; a search without a model,
   or whose embedding call failed, runs on text and the page says so.
2. **Explained verdicts** in the server (`src/lib/briefs/matching.ts`,
   pure, tested): one verdict per criterion, `match`, `partial`, `missing`
   or `not_stated`, each with the evidence it rests on (the skill, the
   language and its level, the years, a snippet of the CV). Rules per kind
   are stated once in that file (CEFR levels and the usual words, language
   aliases, years within one of the target as partial, a free criterion
   can be found but never judged absent).
3. **Score and coverage**: points are `match` 1, `partial` 0.5, `missing`
   0, weighted by the criterion's weight; the score is 0..100 over the
   criteria that could be evaluated, `coverage` is their share of all
   criteria ("4 criteria out of 5 evaluated"), and `blocked` is true when a
   required criterion is missing. Ranking: not blocked first, then score,
   then coverage, then retrieval order. A blocked candidate is shown with
   the missing requirement named, never hidden.

With a model, the top twelve results get a `why`: two or three factual
sentences from the model about the match, in the brief's language, from
the profile and the verdicts only (prompt in `src/lib/briefs/prompts.ts`).
A model that does not answer leaves `why` null and the card shows the
verdicts alone. The whole search is stored as a `searches` row (query,
criteria at run time, results, method, who ran it) and previous searches
reopen from their stored results.

## Shortlists

One shortlist per brief (`shortlists.brief_id` is unique), created on the
first "add to shortlist" from a search result, which carries the explained
match as a snapshot (`shortlist_items.match`). The board
(`/app/shortlists/:id`) has three sections: **to review**, **retained**,
**dismissed** (`shortlist_items.status`), stacked on a phone, side by side
from `sm:`.

- **Decisions**: a member retains, dismisses or reviews again. The database
  stamps `decided_by` and `decided_at` from the session; the card shows
  "Retained by Ana · 2 h ago" from those columns, never from the browser.
- **Votes**: one per person per item, +1 or −1 (`votes`, own row only).
- **Comments**: a thread per item with `@` mentions over the team
  (`comments.mentions`, member ids read from the final text), editable by
  the author, deletable by the author or an admin.
- **Assignment**: `assigned_to` names who follows the candidate; the list
  page shows the assignees of each shortlist.
- **Note**: a shared note per item, saved when the field loses focus.
- **Decision trace**: every change is a row in `activities`, written by
  database triggers (`shortlist.added`, `shortlist.removed`,
  `shortlist.status`, `shortlist.assigned`, `comment.added`), read in the
  item's history and in `/app/activity`.
- **Realtime**: `shortlist_items`, `comments`, `votes` (and `documents`,
  `activities`) are in the `supabase_realtime` publication with full replica
  identity; the board subscribes under RLS and debounces changes into one
  re-read.

Viewers read the board; members write; the buttons follow the role and
RLS checks again.

## Sharing

A shortlist is shared as a presentation the hiring manager opens without
an account (`/share/<token>`, `src/routes/share/$token.tsx`, outside the
app shell, in the sharing organisation's language):

- **The share** (`shares`, members, rate-limited, `src/lib/shares`): a
  title, an intro, up to thirty candidates of the shortlist as a snapshot
  (`items`: name, headline, a summary, strengths, points of attention, the
  latest processed CV), whether CVs are included, and an expiry of 1 to
  30 days (14 by default). The dialog has three steps: content, review,
  send. With a model, the summaries are drafted in one call from the
  profiles (`ai_usage` kind `summary`) and the team edits them before
  sending; without, the plain draft (name, headline, top skills) is left
  for the team to write.
- **The token** (32 random bytes, base64url) is shown once, in the link,
  when the share is created. The row holds its SHA-256 only
  (`shares.token_hash`, not granted to the browser); the page hashes the
  token it receives and reads the share with the service role. `shares` is
  written by the server only: the browser has no insert or update grant.
- **Expiry and revocation**: `expires_at` is checked on every open and
  the page says when the link stops working; `revoked_at` ends a share at
  once (a revoked link says so even after its date). Opens are counted
  (`view_count`, `last_viewed_at`, best effort) and the shares of a
  shortlist are listed under its board with their state and the emails
  sent. `share.created`, `share.sent` and `share.revoked` go to the
  activity log.
- **CVs** on the page open through `GET /api/share/<token>/cv/<documentId>`,
  which answers a redirect to a signed link of 120 seconds when the token
  opens an active share that includes CVs and carries that document, and
  a plain 404 otherwise. Nothing about storage is in the page.
- **Email**: the link is sent through Resend to the addresses the team
  enters (kind `share` in `email_sends`), built on `SITE_URL`; the email
  says the date the link stops working. The browser sends the link back
  for the email and the server checks it is this site's and shaped like a
  share link before anything goes out.
- **PDF**: the page is a white, printable sheet; the hiring manager prints
  it to PDF from the browser. There is no server-side rendering.

## Model

The model sits behind any OpenAI-compatible API, chosen per deployment with
four variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`LLM_EMBEDDING_MODEL`), read by the Worker (`src/lib/model/model.server.ts`)
and by the processor (`services/processor/src/model.ts`) with the same
conventions:

- **Mistral** is the recommended vendor (European hosting):
  `LLM_BASE_URL=https://api.mistral.ai/v1`, `mistral-small-latest` and
  `mistral-embed` by default when the base URL is Mistral's.
- **OpenAI** works with `https://api.openai.com/v1`, `gpt-4o-mini` and
  `text-embedding-3-small` (shortened to 1024 dimensions by the API).
  Anthropic through a gateway, Groq, Together, OpenRouter and a local Ollama
  expose the same chat and embeddings calls.
- **Embeddings are 1024 wide** (`EMBEDDING_DIMENSIONS`, the width of every
  `vector(1024)` column). A model answering another width is refused with a
  sentence naming the variable to change.
- **Every answer is JSON**, validated with a zod schema, one retry quoting
  the validation error, then an error, never a partial object.
- **Usage is recorded** in `ai_usage` per organisation and kind
  (`structure`, `embed`, `ocr`, `brief`, `explain`, `summary`) with the
  model and the tokens; administrators read it.
- **Rate limits**: every server function that calls the model, sends an
  email, creates a share, pokes the processor or runs a search is behind
  `enforceRateLimit(scope)`: 60 calls per minute per client (the address,
  an IPv6 by its /64, and the user id as a second bucket). A throttled call
  answers `RATE:limited` and the page says to try again in a minute.
- **Without a key** `modelConfigured()` is false: criteria are typed in,
  searches run on text, summaries are written by hand, the processor
  structures by heuristics. Nothing is made up.

## Email

Resend sends the product's emails, transactional only: an invitation and
a shared shortlist. Nothing marketing, nothing to a candidate. The sender
is `EMAIL_FROM` (a verified domain on Resend), links are built on
`SITE_URL`. Every send is a row in `email_sends` written with the service
role before the call (`queued`), then `sent` with the provider id or
`failed` with a short reason; the row id is the `Idempotency-Key`, so a
retry never sends twice. Without `RESEND_API_KEY` or `SITE_URL` the server
answers `SETUP:email`: an invitation then shows its link to the inviter,
a share cannot be emailed and the dialog says so.

## GDPR

Vivier is a tool the organisation (controller) uses; the publisher is its
processor for candidate data. What the product does:

- **Retention per organisation**: `organizations.retention_months`, 1 to
  24 (default 24, the CNIL's ceiling for a recruitment pool), set by an
  administrator. A candidate is due when `last_contact_at` (else the
  upload) plus the retention is past; the profile page shows the date
  (`retention_due_at()`, computed in the database).
- **Hourly purge** by the processor: `expired_candidates()` lists the
  candidates past their retention or whose consent is withdrawn; the files
  of their documents are removed from the bucket first, then the row (the
  cascade takes documents, shortlist items and comments; the trigger logs
  `candidate.deleted`). A candidate whose files could not be removed waits
  for the next pass: a row never outlives its files.
- **Consent**: `consent_status` is `unknown`, `given` or `withdrawn`, with
  `consent_at`; withdrawing is confirmed first because the purge then
  deletes the profile within the hour.
- **Export**: the profile page builds one JSON file in the browser from the
  rows the person can read (the profile and its documents with the text
  extracted from each CV; never `fingerprint` or `search_text`).
- **Erasure**: an administrator types the candidate's name; the server
  (`eraseCandidate`) removes the files, deletes the row and logs who did it.
- **Audit log**: `activities`, written by triggers and server functions,
  read by every member at `/app/activity` and on each item's history.
- **Never extracted**: age, date of birth, gender, nationality or origin,
  photo, family situation, health, religion, union membership, political
  opinions. Not as fields, not as criteria, not in explanations.
- **Accounts**: a person deletes their own account from `/app/account`.

The register of processing, the candidate information notice (FR and EN)
and the procedure for access and erasure requests are in `docs/RGPD.md`.
The privacy policy and the terms (`src/components/legal-page.tsx`) are
written for the product as built; the owner completes the legal identity
before going live (`docs/GO-LIVE.md`).

## Status

`/status` (noindex) shows what this deployment has set up, as presence
only: the site URL, accounts, the service key, the model and the embedding
model (their names, not the key), email, the throttle; then the processor:
configured, reachable (with its version), healthy, database, model, OCR,
queue polled, from its `GET /health`. No value is ever printed
(`describeSetup()` answers booleans and public names only). The processor's
`GET /metrics` (behind the shared secret) holds usage counters since the
process started.

## Deployment

- **Frontend**: a Cloudflare Worker created from this repository with the
  Git integration, root directory `vivier`, build `bun run build`, deployed
  with wrangler on every push to `main`. Variables and secrets live in the
  dashboard (`keep_vars` keeps them across deploys); `PROCESSOR_URL` is the
  one variable `wrangler.jsonc` declares (empty until the service exists).
- **Processor**: a Railway service from this repository, root directory
  `vivier`, Dockerfile `services/processor/Dockerfile`, watch paths
  `services/processor/**`, health check `/health`. Variables as in the
  table above; `PORT` is Railway's. After the first deploy, the logs show
  `polling: true` and `/status` sees it. A stop sends SIGTERM: the
  documents in flight get 25 s, the rest goes back to the queue.
- **Database**: migrations are applied to the Supabase project before the
  code that needs them is deployed.

## Validation

- Frontend: `bun install --frozen-lockfile`, `bun run build` (generates
  `src/routeTree.gen.ts`, which the typecheck imports), `bun run typecheck`,
  `bun run test` (Bun 1.3.9, Node 22).
- Processor: `npm install` (`npm ci` once `package-lock.json` is
  committed), `npm run typecheck`, `npm test`, `npm run build` from
  `services/processor`; `docker build -f services/processor/Dockerfile .`
  from `vivier/`; `GET /health` answers 200.
- CI: `.github/workflows/vivier-ci.yml` runs the `Vivier frontend` and
  `Vivier processor` jobs on every pull request. Each job checks only when
  its paths changed and reports green in seconds otherwise, so both checks
  can be required in the main branch ruleset. The processor job builds the
  production image and checks `/health` before the image is trusted. No
  secret, no production call; it never deploys or merges.

## Backups

Supabase's Point-in-Time Recovery is the primary line; a nightly workflow
(`.github/workflows/vivier-backup.yml`, `scripts/backup.sh`) adds a logical
dump of the database and a copy of the `cvs` bucket to an R2 bucket, kept
thirty days, with a restore drill to run before go-live and every quarter.
Doctrine, setup and the drill: `docs/BACKUPS.md`.

## Moving to a dedicated repository

Vivier is self-contained under `vivier/` (its own package.json, lockfile,
Supabase project, Worker, Railway service and CI workflow); nothing imports
anything from outside it. The mechanical move with `git subtree split` and
what to adjust afterwards is in `docs/EXTRACT.md`.

## Not built yet

Said plainly so no page or document pretends otherwise:

- **Billing**: the plan grid, the seat and quota limits and
  `sync_plan_from_billing()` exist; there is no Paddle checkout, no
  `/api/paddle/webhook`, no customer portal. Every organisation starts on
  `trial` and stays there until the owner changes the plan by hand with
  the service role.
- **OCR without a Mistral key**: scanned PDFs end in `needs_ocr` with a
  sentence; no other OCR vendor is wired.
- **Server-side PDF rendering**: the shared page prints to PDF from the
  browser; nothing renders a PDF on the server.
- **Processor lockfile**: `services/processor/package-lock.json` is
  generated and committed by the first person with network access; until
  then CI and the Dockerfile install from the ranges in `package.json`.

## Contributing

Rules of the road live in `AGENTS.md`; how a feature is laid out and the
helpers every feature uses in `docs/CONVENTIONS.md`. One branch and one
pull request per evolution, never a push to `main`, CI green before a
merge, no new dependency without the owner.
