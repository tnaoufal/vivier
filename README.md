# Vivier

Vivier is the collaborative talent pool for HR teams: upload the CVs you
receive (up to 10 000 in one import), let a model read them into structured
profiles, check the pool against a brief requirement by requirement with
the evidence quoted from each CV, build a shortlist as a team (status,
votes, comments, assignment, decision trace) and send the hiring manager a
dossier by email: one sheet per candidate, the requirement table on each,
printable. Every decision is a person's, every page says what it knows and
what it does not, and each organisation sets how long its candidates are
kept.

- **Product name**: "Vivier" (a vivier is where talent grows). Name, tagline
  and description live in `src/lib/brand.ts`; the mark is drawn inline in
  `src/components/brand-mark.tsx`. The interface speaks French and English
  (`src/lib/i18n`, one dictionary per feature, `en` must carry every key of
  `fr`, tested).
- **Fonts**: Geist, Geist Mono and Poppins 600, self-hosted from
  `public/fonts/` under the SIL Open Font License. No third-party stylesheet.
- **Where it lives**: its own repository, `tnaoufal/vivier`, apart from
  Namearly; the two share a stack and nothing else.

## Principles

These four rules are enforced in the schema, the server functions and the
pages, not only promised:

- **No machine decision.** The model structures CVs, proposes criteria from
  a brief, and assesses each profile against the brief's requirements with
  a reading (`fit`, `borderline`, `no_fit`) that rules bound and a person
  weighs. A person retains or dismisses, and the database stamps
  `shortlist_items.decided_by` / `decided_at` from the caller's session
  (`stamp_shortlist_decision()` trigger), never from the browser or the
  model. The UI shows who decided and when.
- **`not_stated` is never a mismatch.** A criterion the CV says nothing
  about is `not_stated`: it is excluded from the score and the coverage says
  how many criteria could be evaluated; a verdict of `missing` is given only
  when the CV contradicts the requirement, with that evidence. The model's
  assessment obeys the same rule: a "no" it cannot quote becomes "unknown"
  (`enforceAssessment()`). A field the structuring did not read is absent
  (and shown as "not stated"), never invented.
- **No sensitive inference.** Age, date of birth, gender, nationality or
  origin, photo, family situation, health, religion, union membership and
  political opinions are never extracted, stored or used as criteria. The
  structuring prompt forbids them, the criteria extraction drops any such
  request and says so (`protectedCriterion()`), the explanation prompt may
  not mention them.
- **Honest pages.** A document that failed or was set aside says why in one
  sentence (`documents.error`, written by the processor only), an analysis
  run without a model says it ran on text alone (`searches.method = 'text'`),
  one run on a pool larger than it reads says how many profiles were looked
  at (`searches.pool_size`), a dossier says where its table comes from, a
  share says when it expires, a count that could not be read shows a dash,
  and `/status` shows what is set up without a single value.

## Architecture

| Layer     | Where                                       | Notes                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | `src/`                                      | TanStack Start (React 19, file-based routes in `src/routes`), Tailwind v4, shadcn/ui primitives in `src/components/ui`. Server functions in `src/lib/<feature>/<feature>.functions.ts`; server-only modules end in `.server.ts` and live in `src/lib/platform`.           |
| Hosting   | Cloudflare Workers (`wrangler.jsonc`)       | Nitro `cloudflare-module` preset. Every push to `main` deploys through Cloudflare's Git integration (root directory `vivier`); CI never deploys. `keep_vars` protects the dashboard's variables; the `VIVIER_RATE_LIMITER` binding throttles the costly server functions. |
| Data      | Supabase (`supabase/migrations`)            | Postgres 17 with Row Level Security on every table, Auth (email + Google), Storage (the private bucket `cvs`, PDF only, 25 MB), Realtime on the collaborative tables, pgvector (HNSW, cosine) for hybrid search. EU region.                                               |
| Processor | `services/processor`                        | Node 22 + Fastify 5 on Railway with the service role key: reads queued PDFs, sets aside what is not a CV, structures the rest (model or heuristics), finds the person already in the pool (email, phone, fingerprint), computes embeddings, and runs the hourly maintenance (stale reset, retention purge, re-embed). Documented in `services/processor/README.md`. |
| Email     | `src/lib/email/email.server.ts`             | Resend, transactional only (invitations, dossiers). Every send is a row in `email_sends`.                                                                                                                                                                                 |
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

The Supabase project: create one (EU region), apply the files of
`supabase/migrations` in order (`supabase link` then `supabase db push`,
or the SQL editor): `20261013090000_vivier_init.sql` creates the schema,
the policies, the `cvs` bucket, the functions and the realtime
publication; the `20261013180000`, `…190000` and `…200000` files are
evolution 2 (rejected documents and similar profiles, the dossier's brief
snapshot and the dedup columns, the pool size of an analysis). Then enable
Email and Google in Auth and add `http://localhost:5173/**` to the
redirect allow list. Nothing is set up by hand in the dashboard beyond
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

Frontend (from the repository root):

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
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`, `LLM_ASSESSMENT_MODEL` | The model (see "Model"): any OpenAI-compatible endpoint, its key, the chat model, the embedding model and, optionally, a stronger chat model of the same endpoint for the expert assessment alone (unset: `LLM_MODEL` assesses too). Without `LLM_API_KEY` the app runs in no-model mode. The first four values go to the processor as well. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`                         | Resend (see "Email"): the key (sending is off without it), the sender (`Vivier <hello@vivier.app>` by default; the domain must be verified on Resend), the reply-to (none by default).                                                                                                                                      |
| `VIVIER_RATE_LIMIT`                                                      | `off` disables the per-client throttle (development only). Inside Workers the `VIVIER_RATE_LIMITER` binding counts 60 calls per minute per scope; elsewhere an in-memory window applies the same policy.                                                                                                                   |

Processor (set on the Railway service; `/health` shows which parts are on):

| Variable                                                                 | Required | Purpose                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROCESSOR_SHARED_SECRET`                                                | yes      | Bearer secret for every route but `GET /health`; at least 32 characters or the process refuses to start (`PROCESSOR_ALLOW_INSECURE_SECRET=1` overrides for CI's smoke test only).                     |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                              | for work | The project and its service role key. Without them the service answers `/health` only.                                                                                                                |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`        | no       | The model, as on the Worker. Without the key: heuristic profiles, nothing set aside, no embeddings. The embedding model must answer 1024 dimensions: the service probes it once at start and `GET /health` says `embedding: ok`, `mismatch` or `unavailable`.          |
| `MISTRAL_OCR_API_KEY` (`MISTRAL_OCR_MODEL`, `MISTRAL_OCR_URL`)           | no       | OCR for scanned PDFs through Mistral's OCR API. Without it, scanned PDFs end in `needs_ocr`.                                                                                                          |
| `PORT`                                                                   | no       | `8080`; Railway sets it.                                                                                                                                                                              |
| `POLL_INTERVAL_MS`                                                       | no       | How often the queue is read (`20000`; `0` disables polling, `POST /process` still works).                                                                                                             |
| `MAINTENANCE_INTERVAL_MS`                                                | no       | How often the retention purge runs (`3600000`, one hour; `0` disables the timer).                                                                                                                     |
| `PROCESSOR_CONCURRENCY`                                                  | no       | Documents processed at once, 1..8 (`4`); lower it if the model answers 429.                                                                                                                           |
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
| Read candidates, documents, briefs, analyses, shortlists, comments, votes, activity, shares, similar profiles |   x    |   x    |   x   |   x   |
| Upload CVs, add or correct a candidate, archive, set consent, put a failed or set-aside document back in the queue |        |   x    |   x   |   x   |
| Create and edit briefs, ask the model for criteria, run analyses                                 |        |   x    |   x   |   x   |
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

1. **Upload** (`/app/candidates`, members): the browser validates the
   selection once (PDF, 25 MB each, up to 10 000 files; refusals counted by
   reason in one sentence), then sends it in **lots of 100**, three files at
   a time inside a lot: each file is hashed (SHA-256, Web Crypto), looked up
   by hash in the organisation, uploaded to the private bucket at
   `<org_id>/<document_id>.pdf` and inserted as a `documents` row with
   `status = 'queued'` (`uploaded_by` must be the caller; RLS checks it and
   the folder). After each lot the dialog asks the server to poke the
   processor with the ids stored (`notifyProcessor`, rate-limited, 50 ids a
   call), so profiles appear while the import runs; the processor polls the
   queue every 20 s anyway, so a missed poke only delays the work and is
   never shown as an upload error. The dialog shows the overall progress,
   four counters and the current lot only (never 10 000 rows); closing is
   refused while a lot runs, the person may **stop after the lot** and
   **resume** later (the unsent files keep their ids), and once over the
   failed files can be **retried** with fresh ids
   (`src/lib/candidates/upload.ts` and `upload-runner.ts`, pure and tested).
2. **Processing** (the processor, with the service role): claims the row
   (`queued` → `processing`, atomically, four documents at a time), checks
   the organisation's monthly quota (`cvs_processed_this_month()` against
   `cv_quota_month`), downloads the file, writes its SHA-256, reads the text
   layer, structures it with the model, which says in the same call whether
   the text is one person's CV (`document_kind`: `cv` or `other`), finds the
   person already in the pool, writes or merges the candidate, then marks
   the document `processed` with `page_count`, `text_chars`,
   `extracted_text`, `extraction_method` (`pdf-text`, `ocr`, `none`),
   `structuring_method` (`model`, `heuristic`) and `document_kind`.
3. **Outcomes**: `processed`; `rejected` (the model read the file and did
   not take it for a CV: a cover letter alone, a diploma, an identity
   document, a form, a job offer; the text and the sentence are kept, no
   candidate is created or touched, the quota counts the call; only an
   explicit "other" sets a document aside, and nothing is ever rejected
   without a model); `failed` (one French sentence in `documents.error`:
   unreadable file, model did not answer, processing failed, monthly quota
   reached); or `needs_ocr` (a scanned PDF and no OCR key). A member can put
   a `failed`, `needs_ocr` or `rejected` document back to `queued` from the
   profile page or the banner above the list, which counts the documents
   set aside apart so a wrong reading is seen and retried; it is the only
   status change the browser may make (`guard_document_update()` trigger).
   A document left in `processing` for ten minutes is re-queued; after
   three claims it is left `failed` so a crashing file cannot loop.

Dedup, twice. The unique index on `documents (org_id, sha256)` refuses a
file the organisation already has: the duplicate document is attached to
the existing candidate (or set aside too when the original was), costs
nothing and is not counted against the quota. Then the **same person
across different files** (two exports of one CV have different bytes) is
found in this order, the first hit winning: the candidate the document was
pinned to (uploaded from a profile page); the email, case-insensitively;
the phone number by its last nine digits (`candidates.phone_digits`, a
column the database computes from `phone`, so "+33 6 12 34 56 78" and
"06.12.34.56.78" meet); the **fingerprint** (the email, else name + phone
digits, else name + the latest company or first school). A name alone
never merges, and a contact detail alone does not merge two people whose
names disagree (both names full and not one word in common: a CV sent
through an agency or a family mailbox never gives one person another's
background; the refusal is logged). An archived namesake is matched only
when alone, and a fresh CV then puts the person back in the pool. The
lookup and the write run one organisation at a time inside the processor,
so two copies uploaded together cannot both insert. The new reading is
merged into the profile found (a value is kept unless it is empty or the
new one is confident, ≥ 0.7 and at least as confident; skills and tags are
unioned; confidences keep the max). A candidate can also be typed in by
hand (`source = 'manual'`, members).

Confidence per field: the structuring returns a 0..1 confidence for each
field it read (`candidates.confidence`). The profile page shows "to check"
or "uncertain" next to a field accordingly, never a verdict on the person;
a missing key means the field was not read and is shown as "not stated".

No-model mode: without `LLM_API_KEY` the processor still runs: an email
and a phone by regex, a name from the first lines or the file name, low
confidence on each, every other field empty, no embedding, no document set
aside (`structuring_method = 'heuristic'`, `document_kind` null). The list
shows such rows as "to check".

OCR: a PDF with fewer than 150 readable characters per page counts as
scanned. With `MISTRAL_OCR_API_KEY` it goes through Mistral's OCR API
(20 MB, 90 s; pages are recorded in `ai_usage` as kind `ocr`); without,
`needs_ocr` and a sentence telling the person to enable OCR or type the
profile in.

The profile page (`/app/candidates/:id`) shows what was read, with a form
to correct it (the browser may update the human-readable columns;
`fingerprint`, `search_text`, `embedding` and `confidence` are the
processor's), the CVs behind it (opened through a five-minute signed link),
the team's comments, consent and retention, archive, export and erasure,
and a **Similar profiles** button (every role): a drawer listing the ten
profiles nearest this one as the database ranks them
(`similar_candidates()`, SECURITY INVOKER so RLS applies: cosine distance
between vectors when both profiles carry one, else the words of the
headline and skills through the full-text index), each with its closeness
as a percentage and the measure that spoke. A reading aid for a person who
compares, never a verdict. Lists are live through Realtime on `documents`
and `comments`.

Embeddings: with a model, each processed profile gets a 1024-dimension
vector from its compact text, written after the candidate row, outside the
processor's lock. A failed call never fails the document; the hourly
maintenance pass re-embeds the active candidates still without a vector
(100 calls a pass, newest first). The processor probes the embedding model
once at start and `GET /health` says `embedding: ok`, `mismatch` (the model
answers another width than 1024: fix `LLM_EMBEDDING_MODEL`, redeploy, the
pass fills the gap) or `unavailable`.

## Briefs and search

A brief (`/app/briefs/new`) is a title and free text. Its **criteria** are
rows of `briefs.criteria`: a kind (`role`, `skill`, `experience`,
`language`, `location`, `education`, `availability`, `other`), a label
(what the chip says), a value (what is looked for; up to 600 characters),
`required`, and a weight 1..3. With a model, `extractCriteria` proposes up
to twelve from the text, the role first; the person adds the ones they
keep, one by one or all at once, and nothing reaches the brief without
their gesture. A proposal naming a protected characteristic is dropped and
counted; the model's own warnings about requests it refused are shown.
Without a model, one sentence says so and the criteria are typed in. A
brief analysed with no criteria gets them derived from its text by the
same extraction on that first analysis, saved into the brief, and a toast
asks the person to check them.

**The role comes first.** One criterion of kind `role` per brief is the
job itself: its label is the job as the team names it ("Business
Developer"), its value the *role definition*, a short text in the brief's
language (`src/lib/briefs/criteria.ts`: the job's domain, the three to
six core missions that define the job, the usual equivalent titles under
which other companies name it, the sector when the brief says so), which
the model writes from what the job is in the market, since a brief rarely
spells out the missions. It is required and essential by default; the
team edits the definition or unticks required. The guard against
protected characteristics reads a role's definition on its core list
only (age, sex, origin, nationality, religion, disability, pregnancy,
marital status, union, sexual orientation): a job's domain is written
with words such as "famille de produits" or "politique commerciale" that
say nothing about a person. A brief written before the role existed gets
its role on its next analysis (`runSearch`: one small model call,
`roleDefinitionPrompt`, else the title stands for both; a title that
itself names a protected characteristic is never saved), saved in front
of its criteria with the same "check them" toast, and never added twice;
an analysis stored before that says its verdicts never judged the métier.
The assessment reads the role apart from the other requirements and
judges it before anything else, from what the person *did* (missions,
scope, clients, seniority of the positions) before how the positions were
titled, since every company names a job differently: `yes` when the
person held the role or an equivalent one under another title (a title
with no description is read for what it usually means in its industry),
`partial` for an adjacent role that shares part of the core missions (an
account manager keeps clients, a business developer wins them), for a
role held only long ago or briefly, or for a manager who led the job
without carrying its missions, `no` when the career is another métier
(a CV full of other missions is not silence: the `no` quotes them, and a
core mission met as a side task of another job does not make the role),
`unknown` only when the profile holds no experience at all; the same
missions in another sector are the métier, with the sector named in the
evidence. The rules then bind it before everything else: a role
at `no` forces `no_fit` and caps the score at 25, whatever the other
requirements and whether or not it is still required; at `partial` the
decision is at most `borderline` and the score at most 65; at `unknown`,
`borderline` and 60. The deterministic pass only ever *finds* the role, in
a headline or an experience title that carries the words of its name
(`match`, `partial` for half of them), never `missing`: a different title
is no proof of a different métier. The cards show the role row first as
"Métier · Business Developer".

An **analysis** (`runSearch`, members, rate scope `search`) reads the pool,
then the model reads each result:

1. **The pool**. Up to 200 active candidates (`FULL_POOL_MAX`) the whole
   pool is read, newest first, so no profile is left out by a ranking.
   Above that, **retrieval** in the database (`search_candidates()`,
   SECURITY INVOKER so the caller's RLS applies): full text over
   `candidates.fts` (unaccented, `simple` dictionary so French and English
   both work, the brief's terms joined with OR) and, when the brief could be
   embedded, cosine similarity over the HNSW index, fused by **reciprocal
   rank fusion** (`1/(60 + rank)` from each list), the 120 best rows
   returned (`RETRIEVAL_LIMIT`) and the rest not looked at. `searches.method`
   records `hybrid` or `text` and `searches.pool_size` how many active
   profiles the pool held, so the page says "pool of 1 240 profiles: only
   the 120 closest were read" instead of claiming every profile was.
2. **Deterministic verdicts** in the server (`src/lib/briefs/matching.ts`,
   pure, tested): one verdict per criterion, `match`, `partial`, `missing`
   or `not_stated`, each with the evidence it rests on (the skill, the
   language and its level, the years, a snippet of the CV). `missing` is
   given only when the CV contradicts the requirement (a language absent
   from the listed ones, years below the threshold, a place that
   contradicts) and carries that evidence; a skill the CV does not name is
   `not_stated`. Points are `match` 1, `partial` 0.5, `missing` 0, weighted
   by the criterion's weight; the score is 0..100 over the criteria that
   could be evaluated, `coverage` their share, `blocked` true when a
   required one is missing. Ranking: not blocked first, then score, then
   coverage. The whole analysis is stored as a `searches` row (query,
   criteria at run time, results, method, pool size, who ran it) and
   previous analyses reopen from their stored results, assessments
   included.
3. **The expert assessment** (`assessCandidates`, members, rate scope
   `assess`), with a model and criteria only: does this CV answer this
   brief? The browser drives it after the search, **six candidates a
   batch**, one batch after the other (`ASSESS_BATCH_MAX`), updating the
   cards as batches return; the person may interrupt it and resume later,
   and leaving the page stops it (what was assessed is stored). Each
   candidate is one JSON call with the brief and the profile, read as a
   senior recruitment consultant would before presenting the candidate:
   the structured fields first, then the CV's text clipped to the budget,
   with the name, e-mail addresses and phone numbers removed from every
   text (`redactIdentity()`: the model reads a profile, not a person). It
   answers one row per requirement (`yes`, `partial`, `no`, `unknown`, with
   a quote of at most 200 characters), a decision (`fit`, `borderline`,
   `no_fit`), a score 0..100 and two to four sentences for a hiring
   manager, in the brief's language. **Rules then bind the answer**
   (`src/lib/briefs/assessment.ts`, pure, tested): every criterion gets a
   row (a skipped one is `unknown`); a `yes` without evidence becomes
   `partial`; a `no` without evidence becomes `unknown`, unless the
   deterministic pass found the requirement missing with evidence of its
   own, which is then shown; a `yes` on a required criterion the
   deterministic pass contradicts becomes `partial` with both readings; a
   required requirement at `no` forces `no_fit` and caps the score at 39;
   at `unknown` it caps the decision at `borderline` and the score at 69;
   at `partial` it caps the decision at `borderline`; `fit` needs 70,
   `borderline` 45; the model's own stricter decision is never raised. The
   assessment is written into the same `searches.results` entry (with the
   model that answered) and carried to the brief's shortlist items that
   still hold an unassessed match, so the board and the dossier show what
   the brief page shows. Each call is one `ai_usage` row of kind `assess`
   and may use its own model (`LLM_ASSESSMENT_MODEL`, see "Model"). One
   failed candidate leaves that card unassessed and "resume" picks it up.

The brief page groups the results by decision: **matching**, **to check**,
**set aside** (collapsed: never deleted, only out of the way, the first
required requirement missing named on each card), **not analysed**; each
card carries the fit ring, the decision pill, the requirement rows with
their evidence and the model's reading, introduced as the model's. Without
a model, or when the brief has no criteria, the panel says so and shows the
deterministic ranking alone. The `why` sentences of analyses stored before
evolution 2 (`ai_usage` kind `explain`) are still read where present;
nothing writes them any more.

## Shortlists

One shortlist per brief (`shortlists.brief_id` is unique), created on the
first "add to shortlist" from a result, which carries the match as a
snapshot (`shortlist_items.match`: the verdicts, the assessment when the
model answered, and the criteria of that analysis, so the table is read
against the right brief whatever the brief becomes). An item added before
its batch returned receives the assessment when it does (members insert a
match, never update one; the server fills only an unassessed one). The
card shows the fit score as a ring, the drawer the requirement table with
its evidence and the model's reading. The board
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

## Sharing: the dossier

A shortlist is shared as a **dossier** the hiring manager opens without an
account (`/share/<token>`, `src/routes/share/$token.tsx`, outside the app
shell, in the sharing organisation's language): a cover with what was
looked for, an overview of the profiles, then one sheet per candidate.

- **The share** (`shares`, members, rate-limited, `src/lib/shares`): a
  title, an intro, up to thirty candidates of the shortlist as a snapshot
  (`items`), whether CVs are included, and an expiry of 1 to 30 days (14 by
  default). Each item holds the facts the CV states (name, headline,
  location, years of experience, availability, the first skills, the
  languages), the **requirement table** (one row per requirement: met, in
  part, not met, or not stated, with the evidence quoted from the CV), the
  fit **score** and **decision** when a model assessed the profile, a
  synthesis, strengths, points of attention, and the latest processed CV.
  The table, the score and the decision come from the match the shortlist
  holds (`src/lib/shares/draft.ts`, read the way the board reads it) and
  are read-only in the dialog's three steps (content, review, send); the
  prose is editable. With a model, the synthesis and the points are
  drafted in one call from the profiles, the brief and the assessment
  (`ai_usage` kind `summary`; the prompt says the table is fixed and
  silence is never a lack); without, strengths are the requirements met and
  attention points the ones not met or met in part, for the team to edit.
  A profile the shortlist never analysed says so on its sheet rather than
  showing an empty table.
- **The brief's snapshot** (`shares.brief`: title, description clipped,
  requirements with their required flag) is taken by the server from the
  shortlist's brief when the share is created, never from the browser; the
  cover shows it as "what we looked for" whatever the brief becomes later.
  A share created before this column reads as a dossier without a cover
  brief, and says so.
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
  says what the dossier holds and the date the link stops working. The
  browser sends the link back for the email and the server checks it is
  this site's and shaped like a share link before anything goes out.
- **PDF**: the page is a white sheet with dark ink on any theme
  (`share-sheet`), laid out for A4 with a 16 mm margin and one sheet per
  printed page; "Print / Save as PDF" is the browser's print, and the
  footer says the analysis proposes a reading and a person decides. There
  is no server-side rendering.

## Model

The model sits behind any OpenAI-compatible API, chosen per deployment with
four variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`LLM_EMBEDDING_MODEL`), read by the Worker (`src/lib/model/model.server.ts`)
and by the processor (`services/processor/src/model.ts`) with the same
conventions, plus one the Worker alone reads (`LLM_ASSESSMENT_MODEL`):

- **Mistral** is the recommended vendor (European hosting):
  `LLM_BASE_URL=https://api.mistral.ai/v1`, `mistral-small-latest` and
  `mistral-embed` by default when the base URL is Mistral's.
- **OpenAI** works with `https://api.openai.com/v1`, `gpt-4o-mini` and
  `text-embedding-3-small` (shortened to 1024 dimensions by the API).
  Anthropic through a gateway, Groq, Together, OpenRouter and a local Ollama
  expose the same chat and embeddings calls.
- **The assessment may use a stronger model**: `LLM_ASSESSMENT_MODEL` names
  another chat model of the same endpoint for `assessCandidates` only
  (`completeJson({ model })`); unset, `LLM_MODEL` assesses too. The
  assessment is where the product's worth sits (does this CV answer this
  brief?), so when budget allows set it to a stronger model such as
  `mistral-medium-latest` and keep `mistral-small-latest` for structuring,
  criteria and summaries; `ai_usage.model` records which one answered.
- **Embeddings are 1024 wide** (`EMBEDDING_DIMENSIONS`, the width of every
  `vector(1024)` column). A model answering another width is refused with a
  sentence naming the variable to change; the processor probes the model
  once at start and shows the state on `GET /health` (`embedding`).
- **Every answer is JSON**, validated with a zod schema, one retry quoting
  the validation error, then an error, never a partial object.
- **Usage is recorded** in `ai_usage` per organisation and kind
  (`structure`, `embed`, `ocr`, `brief`, `assess`, `summary`; `explain` for
  rows written before evolution 2) with the model and the tokens;
  administrators read it. An analysis costs one `assess` call per profile
  read, so a pool of 200 is 200 calls of about 9 000 characters each.
- **Rate limits**: every server function that calls the model, sends an
  email, creates a share, pokes the processor, runs a search or assesses a
  batch is behind `enforceRateLimit(scope)` (scopes `model`, `email`,
  `share`, `processor`, `search`, `assess`): 60 calls per minute per client
  and per scope (the address, an IPv6 by its /64, and the user id as a
  second bucket), so an analysis of 200 profiles (34 batches) fits in its
  scope. A throttled call answers `RATE:limited` and the page says to try
  again in a minute.
- **Without a key** `modelConfigured()` is false: criteria are typed in,
  analyses run on text with the deterministic verdicts alone (no
  assessment, no derived criteria), dossiers are written by hand from the
  verdicts, the processor structures by heuristics and sets nothing aside.
  Nothing is made up.

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
  opinions. Not as fields, not as criteria, not in assessments or dossiers;
  the assessment payload carries no name, e-mail or phone either.
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
(`describeSetup()` answers booleans and public names only). `/health` also
carries `embedding` (`ok`, `mismatch`, `unavailable`, `off`), which
`/status` does not show yet: read it on Railway. The processor's
`GET /metrics` (behind the shared secret) holds usage counters since the
process started, the documents set aside among them.

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
  `polling: true` and, with a model, `embedding_ok`; `/status` sees it. A
  redeploy runs the embedding probe again. A stop sends SIGTERM: the
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
  from the repository root; `GET /health` answers 200.
- CI: `.github/workflows/ci.yml` runs the `Vivier frontend` and
  `Vivier processor` jobs on every pull request. Each job checks only when
  its paths changed and reports green in seconds otherwise, so both checks
  can be required in the main branch ruleset. The processor job builds the
  production image and checks `/health` before the image is trusted. No
  secret, no production call; it never deploys or merges.

## Backups

Supabase's Point-in-Time Recovery is the primary line; a nightly workflow
(`.github/workflows/backup.yml`, `scripts/backup.sh`) adds a logical
dump of the database and a copy of the `cvs` bucket to an R2 bucket, kept
thirty days, with a restore drill to run before go-live and every quarter.
Doctrine, setup and the drill: `docs/BACKUPS.md`.

## Not built yet

Said plainly so no page or document pretends otherwise:

- **Billing**: the plan grid, the seat and quota limits and
  `sync_plan_from_billing()` exist; there is no Paddle checkout, no
  `/api/paddle/webhook`, no customer portal. Every organisation starts on
  `trial` and stays there until the owner changes the plan by hand with
  the service role.
- **OCR without a Mistral key**: scanned PDFs end in `needs_ocr` with a
  sentence; no other OCR vendor is wired.
- **Server-side PDF rendering**: the dossier prints to PDF from the
  browser; nothing renders a PDF on the server.
- **Orphan documents**: a document set aside (`rejected`) or `failed` that
  is pinned to no candidate stays in the bucket and the table until an
  administrator deletes it through the API (the policy exists, no button
  does yet); the retention purge removes candidates and their documents
  only. `/status` does not read the processor's `embedding` state either.
- **Processor lockfile**: `services/processor/package-lock.json` is
  generated and committed by the first person with network access; until
  then CI and the Dockerfile install from the ranges in `package.json`.

## Contributing

Rules of the road live in `AGENTS.md`; how a feature is laid out and the
helpers every feature uses in `docs/CONVENTIONS.md`. One branch and one
pull request per evolution, never a push to `main`, CI green before a
merge, no new dependency without the owner.
