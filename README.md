# Vivier

Vivier is the collaborative talent pool for HR teams: upload the CVs you
receive (up to 10 000 in one import), let a model read them into structured
profiles, analyse the whole pool against a brief in one click (a job the
processor runs: the model reads the consultant's text once, sorts every
profile by métier, scores the ones it kept, reads the best in full with
the evidence quoted from each CV, challenges and tiers them; the page
follows the job), build a shortlist as a team (decisions, assignment, a thread
with @mentions on every brief, candidate and shortlisted candidate) and
send the hiring manager a dossier by email: one sheet per candidate, the
requirement table on each, printable. Every decision is a person's, every
page says what it knows and what it does not, and each organisation sets
how long its candidates are kept. The interface is black and white (the
Blackweaver charter, v4: one ink on paper, a state told by a shape and a
word, never a colour), and every page is one plane, the team's thread
beside the work.

- **Product name**: "Vivier" (a vivier is where talent grows). Name, tagline
  and description live in `src/lib/brand.ts`; the mark is drawn inline in
  `src/components/brand-mark.tsx`. The interface speaks French and English
  (`src/lib/i18n`, one dictionary per feature, `en` must carry every key of
  `fr`, tested).
- **Fonts**: Geist, Geist Mono and Poppins 600, self-hosted from
  `public/fonts/` under the SIL Open Font License. No third-party stylesheet.
- **Design**: `docs/DESIGN.md` is the charter every screen follows (v4,
  Blackweaver monochrome, one plane: the rule, the tokens of
  `src/styles.css` and the two tests that prove them, the plane and the
  primitives of `src/components/ui` and `src/components/app-shell`, what
  moves and why, the icons, the content rules, the page templates).
- **Where it lives**: its own repository, `tnaoufal/vivier`, apart from
  Namearly; the two share a stack and nothing else.

## Principles

These four rules are enforced in the schema, the server functions and the
pages, not only promised:

- **No machine decision.** The model structures CVs, reads a brief once
  into a role profile and requirements (the consultant's text is the only
  source; nobody checks or edits that reading), sorts the pool by métier,
  scores the profiles it kept and reads the best of them against the
  requirements with a reading (`fit`, `borderline`, `no_fit`) that rules
  bound and a person weighs. A person retains or dismisses, and the database stamps
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
  origin, family situation, health, religion, union membership and
  political opinions are never extracted, stored or used as criteria. The
  structuring prompt forbids them, the brief's reading drops any such
  request (`protectedCriterion()`, counted in the log, nothing of it
  stored), and no prompt may mention them. The photo on a CV's first page is kept as a small
  file for identification only (`candidates.photo_path`, the private
  `photos` bucket): never a field, never a criterion, never sent to a
  model, never on a dossier, off for the whole organisation with
  `organizations.show_photos`.
- **Honest pages.** A document that failed or was set aside says why in one
  sentence (`documents.error`, written by the processor only), an analysis
  that failed says why in one line (`searches.error`, the processor's too:
  the model unavailable, the brief changed under the run), one stopped
  says how many profiles are left, one stored before the whole pool was
  read says how many profiles it looked at (`searches.pool_size`), one run
  on the text alone says so (`searches.method = 'text'`), a dossier says
  where its table comes from, a share says when it expires, a count that
  could not be read shows a dash, and `/status` shows what is set up
  without a single value.

## Architecture

| Layer     | Where                                       | Notes                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | `src/`                                      | TanStack Start (React 19, file-based routes in `src/routes`), Tailwind v4, shadcn/ui primitives in `src/components/ui`. Server functions in `src/lib/<feature>/<feature>.functions.ts`; server-only modules end in `.server.ts` and live in `src/lib/platform`.           |
| Hosting   | Cloudflare Workers (`wrangler.jsonc`)       | Nitro `cloudflare-module` preset. Every push to `main` deploys through Cloudflare's Git integration (root directory `vivier`); CI never deploys. `keep_vars` protects the dashboard's variables; the `VIVIER_RATE_LIMITER` binding throttles the costly server functions. |
| Data      | Supabase (`supabase/migrations`)            | Postgres 17 with Row Level Security on every table, Auth (email + Google), Storage (the private buckets `cvs`, PDF only, 25 MB, and `photos`, PNG or JPEG, 2 MB), Realtime on the collaborative tables, pgvector (HNSW, cosine) for hybrid search. EU region.                                               |
| Processor | `services/processor`                        | Node 22 + Fastify 5 on Railway with the service role key: reads queued PDFs, sets aside what is not a CV, structures the rest (model or heuristics), finds the person already in the pool (email, phone, fingerprint), reads the candidate's photo off the first page, computes embeddings, runs every analysis of a brief against the pool as a job (the brief's reading, the triage, the screening, the full readings, the second opinions, the tiers: no model call for an analysis is made anywhere else), and runs the hourly maintenance (stale reset, retention purge, re-embed, the photo pass). Documented in `services/processor/README.md`. |
| Analysis  | `packages/analysis`                         | `@vivier/analysis`, the pure part of the analysis (the types, the deterministic matching, the criteria and the role profile, the prompts and the payloads, the assessment's rules, the composite score, the tiering, the triage, the screening, the funnel's rules, the run's state machine), with no dependency. The web app reads it straight from its sources through a path alias, the processor from its built `dist/` through a `file:` dependency; the rules are in `docs/CONVENTIONS.md`. |
| Email     | `src/lib/email/email.server.ts`             | Resend, transactional only (invitations, dossiers). Every send is a row in `email_sends`.                                                                                                                                                                                 |
| Billing   | `src/lib/db/types.ts` (`Plan`), `plan-usage` | Paddle, later: the plan grid and `sync_plan_from_billing()` exist, the checkout and the webhook do not (see "Not built yet").                                                                                                                                             |

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
snapshot and the dedup columns, the pool size of an analysis),
`20261014090000` evolution 3 (`briefs.role_profile`), `20261014130000`
evolution 4 (`candidates.photo_path`, `organizations.show_photos`, the
`photos` bucket), `20261015090000` evolution 5 (`search_triage` and its
three functions, the summary counts of `searches`), `20261015120000`
evolution 6 (`seniority_band()`, and `similar_candidates()` answering the
neighbour's years, seniority first), `20261015150000` evolution 7 (the
job's columns of `searches`, the screening's columns of `search_triage`
with `record_screen()` and `bump_triage_attempts()`, the usage kind
`screen`, `candidates.photo_checked_at`) and `20261016090000` evolution 7
part B (`organizations.kind`, `create_organization()` with the kind,
`accept_invitation()` turning a personal space into a team, the
organisation's row in the realtime publication). Then enable
Email and Google in Auth and add `http://localhost:5173/**` to the
redirect allow list. Nothing is set up by hand in the dashboard beyond
Auth and the secrets.

Secrets for local server functions go in `.dev.vars` (wrangler) or your
shell, never in `.env` (CI refuses a committed env file holding a key).
Without a model key the app runs end to end in no-model mode and says so;
without the processor, uploads stay `queued` and an analysis waits on
"En attente" (the processor runs it); without Resend, an invitation
shows its link to the inviter instead of emailing it.

The processor, in a second terminal:

```sh
cd services/processor
npm install              # generates package-lock.json the first time: commit it; links packages/analysis
npm run build:analysis   # the shared package into packages/analysis/dist (test, typecheck and build do it themselves)
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
| `bun run test`      | Vitest unit tests (node environment; component tests opt into jsdom); the shared package's tests run here too. |
| `bun run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). |
| `bun run lint`      | ESLint (Prettier is enforced through ESLint).                                     |
| `bun run format`    | Prettier on the whole directory.                                                  |

Processor (from `services/processor`):

| Command             | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm run dev`       | `tsx watch src/server.ts` (build the shared package once first).  |
| `npm run build:analysis` | `tsc` of `packages/analysis` into its `dist/`, which the processor imports (`@vivier/analysis`, a `file:` dependency); `build`, `test` and `typecheck` run it first. |
| `npm run build`     | `tsc` to `dist/`.                                                 |
| `npm start`         | `node dist/src/server.js`.                                        |
| `npm test`          | Vitest (an in-memory database, fake extractors and a fake model; no network). |
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
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`        | The model (see "Model"): any OpenAI-compatible endpoint, its key, the chat model and the embedding model. On the Worker they serve `/status`, the brief page's "a model is set up" and the dossier draft's option; no call of an analysis runs here since evolution 7 (the processor makes them all, on its own values). `LLM_ASSESSMENT_MODEL` is still read, for `/status` alone. |
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
| `MAINTENANCE_INTERVAL_MS`                                                | no       | How often the maintenance pass runs: the stale reset, the retention purge, the re-embed, the photo pass (`3600000`, one hour; `0` disables the timer).                                               |
| `PROCESSOR_CONCURRENCY`                                                  | no       | Documents processed at once, 1..8 (`4`); lower it if the model answers 429.                                                                                                                           |
| `LLM_ANALYSIS_MODEL`                                                     | no       | The chat model every call of an analysis goes to (the brief's reading, the triage, the screening, the full readings, the second opinions, the tiers); `LLM_MODEL` unless set; written on each run's row (`searches.analysis_model`). |
| `ANALYSIS_CONCURRENCY`                                                   | no       | Model calls one analysis keeps in flight, 1..8 (`4`); lower it if the model answers 429.                                                                                                              |
| `ANALYSIS_MAX_RUNS`                                                      | no       | Analyses one process runs at once, 1..4 (`2`).                                                                                                                                                        |
| `ANALYSIS_POLL_INTERVAL_MS`                                              | no       | How often the queued and the stale analyses are claimed (`30000`; `0` disables the scan, the poke and the claim at boot still work).                                                                   |
| `MAX_TEXT_CHARS`                                                         | no       | Cap on the text kept per document (`200000`).                                                                                                                                                         |

No value is ever logged or returned by either service.

## Accounts and roles

Sign-in is Supabase Auth (email + password with confirmation, Google). A
profile row follows each account (`profiles`, created by trigger: email,
display name, language). A person belongs to organisations, the spaces
of the interface (below), through `memberships.role`; the first screen
without one creates a personal space or a team (`create_organization()`,
the caller becomes its owner) or follows an invitation link. The current
space is remembered in the browser; `useOrg()` gives every page `org.id`
and `can(role)`, and `isPersonal(org)` tells a personal space.

Access is decided by the role, in the database (RLS policies and column
grants in the migration) and again in server functions by
`requireMember(accessToken, orgId, minRole)`, which reads the caller from
the access token the browser sends and from nothing else. What each role
may do:

| Action                                                                                          | viewer | member | admin | owner |
| ----------------------------------------------------------------------------------------------- | :----: | :----: | :---: | :---: |
| Read candidates, documents, briefs, analyses, shortlists, threads, activity, shares, similar profiles |   x    |   x    |   x   |   x   |
| Upload CVs, add or correct a candidate, archive, set consent, put a failed or set-aside document back in the queue |        |   x    |   x   |   x   |
| Create and edit briefs, run analyses                                                             |        |   x    |   x   |   x   |
| Add to a shortlist, retain or dismiss, write in a thread (delete own messages), share and send |        |   x    |   x   |   x   |
| Delete candidates, documents and briefs, erase a candidate with their files, delete any message  |        |        |   x   |   x   |
| Invite, revoke invitations, change roles below owner, remove members                             |        |        |   x   |   x   |
| Organisation settings (name, working language, retention, candidates' photos shown)             |        |        |   x   |   x   |
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
it (no column grant). The plan's two usages on the team page
(`/app/members`) are read-only.

## The screens and the spaces

Every signed-in page is one plane that fits the screen: a 64px rail on
the left (the dashboard, the briefs, the pool, the team; the theme
switch; the person's disc, whose menu holds the spaces, a new team, the
settings, the language and the sign-out), a 56px header (the way back,
the title, the page's figures, the one filled button, the thread's
toggle, a menu), and panes side by side that each scroll inside
themselves, a list beside the detail of the row chosen in it (the URL
keeps the row), so the page never scrolls as a whole. The team's thread
on what the page shows is the right pane: open beside the work from
80rem, one click away below that (over the detail, or in a sheet under
64rem), the choice remembered on the device. Under 64rem the rail's
items are in the header's menu, the panes stack and a profile opens full
screen; the layout and each page are in `docs/DESIGN.md` ("Layout",
"Page templates").

What changed for a person in evolution 7 part B. The sidebar became the
rail, with the theme switch on it. The thread left the bottom of the
pages for the right pane. The pool opens a profile beside its list,
sorted by seniority by default. A brief's page shows its profiles in
four groups (the matches, the near profiles, the shortlist, the
profiles set aside) beside the reading of the one selected, and a match
is retained or dismissed in one click, from its row or its reading. The
shortlist's board, cards and drawers are gone, and with them the
assignment and the removal of an item: a profile is dismissed, not
removed. A person who works alone has a personal space.

A person works in spaces. Alone (a freelance recruiter, say), "Je
travaille seul" on the first screen creates a personal space in one
click, named after the person (the profile's display name, else the
email's local part); the rail's fourth item then reads "Espace" and the
team page "Espace personnel". "Je crée une équipe", or "Nouvelle équipe"
in the person's menu (`/app/organizations/new`), creates a team under
the name given. Inviting someone into a personal space makes it a team
the moment they accept, which the team page says in one line
beforehand. The person's menu lists the spaces, the personal one first,
a check on the current one; switching lands on the same section of the
other space (its briefs, its pool, its team) or on its dashboard. In the
database a space is an organisation (`organizations.kind`, `team` or
`personal`, migration `20261016090000`): `create_organization()` sets
the kind, `accept_invitation()` turns a personal space into a team when
a second member joins, the browser never writes it (no column grant),
and the open pages follow the change (the organisation's row is in the
realtime publication). Roles, plans, quotas and retention are the same
for both kinds; leaving is for a team only, since the one member of a
personal space is its owner.

`/app/account` only redirects to the settings (a password-reset link
still lands there, and the password dialog opens by itself). The team
page (`/app/members`, "Équipe" or "Espace personnel") lists the members
and their roles as rows; for administrators a second pane holds the
pending invitations and the plan's two usages, and the header the one
filled "Inviter"; its menu leads to the activity log (`/app/activity`).
The settings (`/app/settings`, "Réglages") hold the space (name, working
language, retention, the photos switch) for administrators, "Mon
compte" (display name, language, theme, password) for everyone, and the
danger zone (leave a team, delete the space, delete the account).

The dashboard (`/app`) says what asks for the person, figures first: a
greeting and the date in the header, one filled button, "Nouveau brief"
(the import while the pool is empty); in the left pane "Mes briefs en
cours", the open briefs as rows (what the newest analysis found, "3
retenus", the thread's last message with who wrote it), the most
recently active first (`src/lib/activity/overview.ts`, read off the
searches' summary columns and the shortlist items' status, never the
results); in the right pane "À traiter", the messages that mention the
person, each leading to its object, and one line for the pool ("1 091
profils · 12 CV en traitement", with a bar while CVs are read) and
"Importer des CV", which opens the pool's import dialog
(`/app/candidates?import=1`). No stat tiles, no activity feed: the log
is at `/app/activity`. Everything re-reads when the briefs, the
searches, the shortlist items, the comments or the documents change.

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
   person already in the pool, writes or merges the candidate, reads the
   photo off the first page when the candidate has none (below), then
   marks the document `processed` with `page_count`, `text_chars`,
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
   profile's sheet or the processing line at the top of the pool's list,
   which counts the documents set aside apart so a wrong reading is seen
   and retried; it is the only
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

Skills are curated, not exhaustive: the structuring prompt asks for the
8 to 20 skills that define the profile, the most central first, as a
recruiter would list them (domains, tools, methods, certifications;
never document names, never generic words unless the CV insists), and
the processor keeps 24 at most (`MAX_SKILLS`). The list row shows the
first three (`keySkills()`), the profile the first eight grouped as
domains, tools and methods by word lists (`src/lib/candidates/skills.ts`:
a layout, never stored, scored or shown as a judgement) with the rest
behind "+ N others". A profile read before this rule keeps its long
list: the merge unions skills and never trims them.

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

Photo: once the candidate row is written, outside the lock and never
fatal, the processor looks at the CV's first page for a portrait
(`services/processor/src/photo.ts`): the images drawn on page 1 (unpdf
`extractImages`, 0.12.2 at least) or, for a scanned PDF, the images the
OCR cut out (`include_image_base64`, stripped from the text). The largest
with the shape of a portrait is kept (both sides 80 to 1200 px, width
over height 0.6 to 1.1, not drawn wider than half the page, so a logo, a
banner or a scan of the page is never taken for a face), downscaled to
256 px and encoded as a PNG by the processor's own encoder (the OCR's
JPEG or PNG kept as it is), written to the private `photos` bucket at
`<org_id>/<candidate_id>.png` and its key to `candidates.photo_path`
(migration `20261014130000`). A candidate with a photo keeps it: a second
CV's images are not read. A candidate read before the photo existed gets
theirs from the hourly maintenance pass, which reads page 1 of their
newest CV with a text layer once, the same way, and marks them checked
whether it found a portrait or not (`candidates.photo_checked_at`,
migration `20261015150000`; a scanned CV is not read again, its portrait
being among the OCR's cut-outs, a billed call the pass never makes). The
photo identifies a person on screen and
nothing else: it never enters a prompt, is never read for anything, and
no column of the profile comes from it. Members see it through signed
links of ten minutes, cached per session (`src/lib/candidates/photos.ts`);
the `Avatar` keeps the initials until it loads and when it fails. An
administrator turns the display off for the organisation on the settings
page (`organizations.show_photos`, for a team that practises anonymous
CVs); the dossier never shows it. The purge and the erasure remove it
with the CVs; the export carries a link to it valid one hour.

The pool (`/app/candidates`) is a list and a sheet. The list shows what
tells rows apart, not every field: one 60px row per profile with the
photo or the initials, the name and the position held today
(`currentPosition()`: the first experience without an end, else the
headline), one quiet line that reads the seniority first, then the
place, then the three skills the CV put first (`listLine()`: "12 ans ·
Casablanca · Python, SAP, MS Project"; a fact the CV does not state is
simply absent from the row, the sheet says "not stated"), the last
update on the right from `sm`, and the one pill that sets a row apart
(archived, listed on demand). The header carries the pool's figure (the
profiles, and the CVs being read while a wave runs), a search over the
name, the headline and the location (at the top of the list below
`lg`), a "Filtrer" button whose popover holds the filters (the
location contains, the years at least, one skill as the profiles write
it with the page's skills suggested, a tag when the page holds some,
and "Afficher les archivés") with their count on the button, and the
one filled action, the import; a person typed in by hand waits in the
header's menu. Above the rows, the sort: seniority (the default), then
recent and name, with a second key on every sort, so a row never shows
on two pages; fifty rows a page. `?c=<id>` is the profile shown beside
the list: from `lg` the first row when the URL names none, and the
arrow keys move along the rows; below `lg` a row opens the profile's
page. `?import=1` opens the import dialog once (the dashboard's
"Importer des CV" leads there). A row reads `experiences` whole and
`photo_path`, never `search_text` or `fingerprint`
(`CANDIDATE_LIST_COLUMNS`).

The sheet of a profile (`CandidateSheet`) is the same beside the list
and on the profile's page (`/app/candidates/:id`, full width, its name
and its actions in the page's header), laid out like a CV a recruiter
reads: the head (the photo in greyscale, else the initials, the name,
the position held today, the seniority first, the place, then the
languages and the availability as quiet text, the pills that set the
profile apart), one filled action ("Voir le CV") and a menu (edit,
similar profiles, export, archive, erase); then the summary on three
lines, the career as a rail of positions with each period and its
duration computed (`formatDuration()`: nothing estimated when a date is
not one), the education, the contact details and the links; beside
them, once the sheet is wide enough, the skills (eight, the rest behind
"+ N"), the documents, the five nearest profiles, the team's tags and
the consent folded behind its one line. The team's thread on the
candidate (`TeamThread`, with @mentions, live) is the thread pane, on
the pool and on the page. Every field the structuring read, with a
confidence hint where it was unsure and "not stated" where it read
nothing; a form in a drawer corrects it (the browser may update the
human-readable columns; `fingerprint`, `search_text`, `embedding`,
`confidence` and `photo_path` are the processor's). **The CV is read in
place**: "Voir le CV" opens the newest processed document (else the
newest, `primaryDocument()`) in a full-size drawer, the PDF in a frame
from a signed link of fifteen minutes with a toolbar (the file, its
size, pages and date; a PDF / Text switch; open in a new tab; download
under the file name), and the text the service extracted as
paragraphs, read on demand (`readDocumentText()`), which is the view a
browser that displays no PDF opens on (`canDisplayPdf()`); each
document of the Documents block has its own "Lire" button. **Similar
profiles**: the sheet shows the five nearest, and "Tout voir" (or
"Profils proches" in the menu, for every role) opens a drawer listing
the ten profiles nearest this one, seniority first:
`similar_candidates()` (migration `20261015120000`, SECURITY INVOKER so
RLS applies) takes the fifty nearest by cosine distance between vectors
when both profiles carry one, else by the words of the headline and the
skills through the full-text index, and orders them by the distance
between seniority bands (`seniority_band()`: 0 to 2, 3 to 5, 6 to 9, 10
to 14, 15 years and more; a band unknown on either side last), then by
similarity; the browser applies the same order again (`orderSimilar()`,
`src/lib/candidates/similar.ts`), so the list reads the same whatever
version of the function the database runs. Each row reads the years
first ("12 ans", or that the CV states none), then the name, the
position, and the proximity as a percentage beside the measure that
spoke. A reading aid for a person who compares, never a verdict. The
sheet is live through Realtime on the candidate's `documents`; the
thread follows its own messages.

Embeddings: with a model, each processed profile gets a 1024-dimension
vector from its compact text, written after the candidate row, outside the
processor's lock. A failed call never fails the document; the hourly
maintenance pass re-embeds the active candidates still without a vector
(100 calls a pass, newest first). The processor probes the embedding model
once at start and `GET /health` says `embedding: ok`, `mismatch` (the model
answers another width than 1024: fix `LLM_EMBEDDING_MODEL`, redeploy, the
pass fills the gap) or `unavailable`.

## Briefs and search

A brief (`/app/briefs/new`) is a title and the consultant's text, nothing
else: one pane with the two fields, "Créer et analyser" in the header,
and the brief page opens with `?run=1` and starts the analysis at once.
The list of briefs shows each one with its status when it is not
simply open, what its newest analysis found (`readLatestAnalyses()`,
read off the counts of its row, never its results: "12
correspondances", "Analyse inachevée", "Aucune analyse"), how many
candidates its shortlist retained, who wrote last on its thread and
when, and when it changed, behind a filter (open, closed, all) that
appears once a brief is closed; the dashboard shows the open
briefs the same way.

**The brief is the only source of the analysis, read once by the model.**
The processor reads it in one call, the first step of a run, when the
brief was never read or its text changed since (`needsDerivation()`: no
`briefs.role_profile`, or its `sourceHash` differs from
`briefSourceHash(brief)`, FNV-1a over the title, a line break and the
text; a profile stored before the hash existed is read again once). The
call (`readBriefPrompt`, temperature 0, `LLM_ANALYSIS_MODEL`, `ai_usage`
kind `brief`, 3 200 tokens out at most) answers one JSON with the **role
profile** and the **criteria**, bound by `enforceBriefReading()` and
saved into the brief in one write (`briefs.role_profile`,
`briefs.criteria`), then copied onto the search as its criteria, so a
run never reads one without the other. Nobody checks or edits the
reading: there is no criteria editor, no proposals, no profile card and
no check step; the requirements appear where they matter (the
requirement rows of each profile's reading, the dossier's table) and the
profile stays internal. A brief the model cannot read fails the run
(`brief_unreadable`); a run that already read profiles on an earlier
reading of a text since changed fails `brief_changed` ("Le poste a
changé : relancez l'analyse."), and a new analysis runs on the new text.
Without a model on the processor nothing reads the brief: the run fails
`model_unavailable`.

**The role profile** (`briefs.role_profile`, JSONB, migration
`20261014090000`, `src/lib/briefs/role-profile.ts`) is what a senior
recruiter writes down about the job before reading a single CV: the
title as the brief names it; the domain as the job is in the market; the
level (`junior`, `confirmed`, `senior`, `manager`, `executive`) with the
years in the role the brief states (`yearsMin`; `yearsMax` only when the
brief itself writes a maximum, `statesMaximumYears()`: a ceiling the
model would infer from the level is a proxy for age and is dropped); the
three to six core missions that define the job; the usual equivalent
titles; the adjacent profiles with what each lacks ("account manager:
keeps clients, does not win them"); the context the brief states and
nothing more (sector, product, clients, scope: a context the brief does
not state is null and is never held against a CV); the must-haves and
nice-to-haves in the brief's words; the success factors; three to five
points to verify in every interview; and the assumptions the model had
to make (the exact métier, the level, the scope). Whatever it answers is
clipped (`cleanRoleProfile()`: texts of 200 characters, lists of 8 items
of 160, 6 missions, 4 assumptions, years 0..60) and guarded
(`guardRoleProfile()` drops any field naming a protected characteristic
on the core list; the log says how many, nothing of it is stored), and
carries the model's name, the date and the hash of the text it was read
from. Every payload reads it: the triage, the screening (the level, the
years and the context judged against it), the full reading and the
tiering (its must-haves). A damaged column reads as no profile, never a
crash (`parseRoleProfile()`).

**The criteria** are rows of `briefs.criteria`: a kind (`role`, `skill`,
`experience`, `language`, `location`, `education`, `availability`,
`other`), a label, a value (what is looked for; up to 600 characters),
`required` (only when the brief states the requirement as mandatory) and
a weight 1..3. The reading answers up to twelve (`EXTRACTION_MAX`), the
most useful first, one per requirement the brief states and nothing the
brief does not say; each of the profile's must-haves is a required
criterion. A request naming a protected characteristic is dropped and
counted in the log. **The role is the first criterion**, exactly one:
its label the job as the model names it (else the brief's title), its
value the *role definition* the assessment reads, read off the profile
(`roleDefinitionOf()`: the domain, the missions, the equivalent titles,
up to 600 characters) so the criterion, the triage and the payloads read
one job; the model's own definition stands only when the profile names
nothing, and a role that itself names a protected characteristic is left
out (the profile's title then stands for the job). A run whose brief's
text changed since it read profiles is not read on under that search:
it fails `brief_changed`, and the header's button runs a new analysis.

An **analysis** is a job the processor runs, never the browser; the
browser never calls a model for it any more. `runSearch` (members, rate
scope `search`) stores the `searches` row (`status = 'queued'`, `method
= 'triage'`, the brief's criteria as they are, no results yet) and pokes
the processor (`POST /analyses/<id>`, best effort: a poke that fails is
logged, and the processor's scan of the table every 30 s picks the row
up). A run of the brief already queued or running is answered as it is,
never doubled; a run stopped or failed on the same reading of the brief
(its text unchanged since the model read it, the same criteria) is
queued again instead of a new row, so it resumes where it was. The
processor claims the row (`status = 'running'`, its name as `runner`, a
heartbeat as it works) and takes the stages of
`packages/analysis/src/analysis-state.ts` in order, each idempotent: a
step reads what it lacks from the database, writes what it settles as it
goes and leaves the stage and the progress on the row, and
`nextStage()` names the next from what is left
(`services/processor/src/analysis/steps.ts`; the operator's view is in
`services/processor/README.md`):

1. **The reading** of the brief, when it is due (above).
2. **The snapshot**: one `search_triage` row per active candidate the
   search lacks (`start_triage()`, one statement, so `searches.pool_size`
   and the rows to read are the same set; a run resumed takes in the
   profiles the pool gained since). Nothing is retrieved, embedded or
   scored: every active profile is read.
3. **The triage by métier** (the package's `triage.ts`, pure, tested):
   forty cards a call (`TRIAGE_BATCH_MAX`), `ANALYSIS_CONCURRENCY` calls
   in flight, the way a senior recruiter briefs a sourcer. Each profile is
   a compact **card** (`triageCard()`): the headline, the position held
   today, four earlier ones with their periods, the total years, the first
   degree without its year, twelve skills; never the name, the contact
   details, the place, a link, the photo, the summary or the CV text, and
   the name, e-mail, phone, place and links are taken out of the card's
   texts too. The cards of a call shrink one level at a time (the skills
   first, then the degree, the earlier companies, the earlier positions;
   the headline and the current position last, since they decide the
   métier) until the message stays under 16 000 characters
   (`triagePayload()`). The job is the role profile (title, domain, level,
   equivalent titles, adjacent profiles, six missions, six must-haves),
   else the role criterion and the brief's title (`triageRoleBrief()`).
   The model (`LLM_ANALYSIS_MODEL`, temperature 0) answers one verdict per
   card with a reason of fifteen words at most: `yes` (the position held
   today or the thread of the career is this job, under any name), `close`
   (an adjacent profile the role profile lists, the job held earlier, the
   same function in a neighbouring domain), `no` (another job), `unknown`
   (no title, or only generic ones nothing on the card ties to a job). A
   shared word does not make the same job; the seniority, the years, the
   place and the detail of the must-haves are left to the screening and
   the full reading; between `close` and `no` it answers `close`. **Rules
   bind the answer** (`enforceTriage()`): a card left unanswered, or a
   verdict outside the four, is `unknown`; a reason that names a
   protected characteristic or a career break is withheld; and **the
   guard** turns a `no` into `close` when the card's current title or
   headline carries the job's title or one of its equivalent titles as
   whole words (`carriesRoleName()`, without what a job ad adds: "H/F",
   "CDI", "(e)"), so a lazy answer never drops a profile that names the
   job. A card with no headline and no titled position is `unknown`
   without a call (`isThinCard()`), as is a candidate gone from the pool.
   The verdicts of a call are written in one statement
   (`record_triage()`, the first write wins); a call the model cannot
   answer (no valid JSON, a 400 or 413, a timeout) counts one failure on
   its cards (`bump_triage_attempts()`) and is read again in halves down
   to ten cards, and a part of ten or fewer that failed twice at that
   size is settled `unknown` ("Fiche illisible par le modèle"), so no
   batch is retried for ever. Only `yes` and `close` go on: a profile at
   `no` or `unknown` keeps its verdict and reason in `search_triage`, and
   the page counts it.
4. **The screening** (the package's `screen.ts`, pure, tested): the kept
   cards, twenty-five a call (`SCREEN_BATCH_MAX`), the same card with its
   positions as lines and the years and the first skills always on it,
   the same splitting. A senior recruiter gives each a score 0..100
   against the brief's reading (the level asked first, then the
   must-haves and the required requirements, then the context) and a
   reason of twelve words at most. `enforceScreen()` keeps a null score
   for a card not answered or scored outside 0..100 (unscorable, never a
   zero) and withholds a reason that names what no sentence may; the
   scores are written in one statement (`record_screen()`, the first
   write wins, and an unscorable card is never sent again).
5. **The promotion**, no model call: `promotable()` takes every row a
   person forced in ("Lire quand même", below) and then the thirty best
   by score (`PROMOTE_MAX`; ties `yes` before `close`), and those the
   results lack enter `searches.results` with the **deterministic
   verdicts** (the package's `matching.ts`, pure, tested: one verdict per
   criterion, `match`, `partial`, `missing` or `not_stated`, each with
   the evidence it rests on, the skill, the language and its level, the
   years, a snippet of the CV; `missing` only when the CV contradicts the
   requirement, a skill the CV does not name `not_stated`, the role only
   ever *found* in a headline or a title that carries the words of its
   name, never `missing`; points `match` 1, `partial` 0.5, `missing` 0,
   weighted by the criterion's weight; the score 0..100 over the criteria
   that could be evaluated, `coverage` their share, `blocked` true when a
   required one is missing) and the triage and the screening on the
   entry (`merge_search_results()`: an entry is never added twice). The
   kept profiles not promoted are the near profiles the page lists under
   its toggle with their score and reason. The whole analysis is one
   `searches` row (query, criteria at run time, results, method, pool
   size, who ran it, the job's columns, and the counts the lists read:
   `result_count`, `assessed_count`, `match_count`, `near_count`); the
   newest row of a brief is the one its page opens, and the earlier rows
   stay.
6. **The full reading**, one call per entry without an assessment,
   `ANALYSIS_CONCURRENCY` in flight, each entry merged as it lands and
   carried to the brief's shortlist item when that item holds a match
   without assessment: does this CV answer this brief? The call
   (`assessmentSystemPrompt`, `LLM_ANALYSIS_MODEL`, temperature 0)
   carries the brief (the role first and apart, its definition the
   profile's; the profile compact: domain, level, years, missions,
   equivalent titles, adjacent profiles, context, must-haves, success
   factors; then the other requirements) and the profile, read as a
   senior recruitment consultant reads a CV before presenting the
   candidate, as a trajectory in the context of the job and not a list
   of keywords: the structured fields first, then the CV's text clipped
   so the payload stays under about 9 000 characters, the name, e-mail
   addresses and phone numbers removed from every text
   (`redactIdentity()`: the model reads a profile, not a person). The
   profile's must-haves are the team's words and are checked through the
   requirements only; the brief's text never adds a requirement
   (something it asks for that no requirement lists is at most a concern
   or a question). The model answers one row per requirement (`yes`,
   `partial`, `no`, `unknown`, with a quote of at most 200 characters
   taken from the profile as it is written), judging the role before
   anything else from what the person *did* (missions, scope, clients,
   seniority of the positions) before how the positions were titled, on
   the most recent and longest positions: `yes` when the person held the
   role or an equivalent one under another title (a title with no
   description is read for what it usually means in its industry),
   `partial` for an adjacent role that shares part of the core missions,
   a role held only long ago or briefly, or a manager who led the job
   without carrying its missions, `no` when the career is another métier
   (a CV full of other missions is not silence: the `no` quotes them),
   `unknown` only when the profile holds no experience at all (for a
   junior brief, internships and first positions are positions); the
   same missions in another sector are the métier, with the sector named
   in the evidence. Then the **five dimensions** a senior recruiter
   weighs, each a score 0..100 with one factual note and the evidence it
   rests on: *role* (the métier judgement as a number: 85 or more when
   the person held the role with the missions in evidence, around 55 for
   an adjacent métier, 20 or less for another, 50 when no experience
   says), *seniority* (the level reached and the years in the role
   against the profile's level and years; above the level is a concern to
   name, around 60, never a disqualifier, judged on the level reached and
   never on a number of years, and only when the brief states a maximum),
   *context* (the sector, product, clients and scope of the positions
   against the profile's; 50 with "the CV does not say" when the brief
   states none or the CV is silent), *trajectory* (the progression and
   coherence of the positions; never a career break, a gap, an age or a
   family situation, here or anywhere else), *achievements* (quantified
   results and the scope handled; 50 when the CV states none: a silent CV
   is not a weak one). Then up to five **strengths** (facts, never
   praise), four **concerns** (facts a recruiter would weigh; a thing the
   CV does not state is a question, not a concern), three **questions**
   for a first call, a decision, its own score, and two to four sentences
   for a hiring manager, the first saying whether the métier is the role
   and on what positions that rests, in the brief's language.

   **Rules then bind the answer** (the package's `assessment.ts`, pure,
   tested). Every criterion gets a row (a skipped one is `unknown`).
   **Every quote is checked against what the model was given**:
   `payloadTexts()` lists the texts of the payload (one per field, one per
   experience with its dates, the timeline of the positions as one), and
   `evidenceGrounded()` looks for the quote in them, case, accents and
   spacing apart: whole when short, else a window of twelve characters
   found verbatim, else 60 % of its tokens of four letters or more found
   as words of one text. A `yes` without a quote, or with one found
   nowhere, becomes `partial`, the quote kept and marked unverified
   ("quote not found in the CV" in the reading); a `no` without a grounded
   quote becomes `unknown`, unless the deterministic pass found the
   requirement missing with evidence of its own, which is then shown; a
   `yes` on a required skill, language, place or years the deterministic
   pass contradicts becomes `partial` with both readings (a degree's
   wording is too varied for that pass to deny one); a dimension's score
   stands above
   neutral (50) only on a grounded quote. A note, an evidence, a strength,
   a concern, a question or a tiering line that names a protected
   characteristic or a career break (`forbiddenSentence()`: the core
   list, the wider words in a personal construction such as "sa famille"
   or "née en 1975", the phrases of a career break or a leave, the job's
   own collocations such as "politique commerciale" or "race condition"
   taken out first) is withheld and counted (`withheld`), and the
   reading says it is incomplete by that much. The **composite
   score** (the package's `scoring.ts`) replaces the model's: role 0.40,
   seniority 0.15, context 0.15, the mean of trajectory and achievements
   0.15, and the weighted coverage of the other requirements 0.15 (`yes`
   1, `partial` 0.5, `no` 0, weighted 1..3 as the brief says, `unknown`
   left out, 50 when nothing is evaluable); a dimension the model did not
   score is neutral; the model's own score is kept apart as `modelScore`,
   advisory, and the reading says what the composite is made of. **The
   gates** then bound the decision and the score, the role first: a role
   at `no` forces `no_fit` and caps the score at 25, whatever the other
   requirements and whether or not it is still required; at `partial` the
   decision is at most `borderline` and the score at most 65; at
   `unknown`, `borderline` and 60 (a junior brief keeps the score: a
   profile with no position at all is the team's to look at, not capped).
   Then the required requirements: one at `no` forces `no_fit` and caps
   the score at 39; at `unknown` it caps the decision at `borderline` and
   the score at 69; at `partial` it caps the decision at `borderline`. A
   `no_fit` the rules can pin on neither the role nor a required
   requirement becomes `borderline`: a profile is never set aside with
   nothing to show for it, and what bothered the model is in its concerns
   with evidence. With the dimensions, a `fit` also needs the role
   requirement at `yes` and the métier dimension at 70 or more
   (`ROLE_DIMENSION_FIT_MIN`), else `borderline`: a brief without a role
   criterion has no métier judged, so nothing in it is presented before
   the team looks. `fit` needs 75 (`FIT_MIN_SCORE`), `borderline` 45,
   below that `no_fit`; the model's own stricter decision is never
   raised. A call the model cannot answer is sent once more; then the
   entry is left unread for this run and counted on the row (`error =
   "assess_failed:<n>"` beside `status = 'done'`; the step reads its
   remaining work from the results, so the same row queued again reads
   those entries alone; the state block says how many readings failed, and
   "Reprendre" or "Relancer" queues that row again rather than a new one).
7. **The second opinion** (retained profiles only, six a batch,
   `CHALLENGE_BATCH_MAX`): one more call per `fit`, with the same brief,
   the same redacted profile and the first reading (decision, score,
   summary, the rows with their labels, the dimension scores and notes,
   the strengths, the concerns), asked for the strongest reason *not* to
   present this profile, in this order: a métier mismatch hidden behind
   titles, a seniority mismatch against the profile, a contradiction
   between facts of the CV, a must-have the first reading marked met that
   the profile does not meet, a context too far when the brief insists on
   it; silence is never a reason, nor is a reservation the first reading
   already lists. It answers `confirmed` (with one sentence on what the
   profile rests on) or `doubt` with a reason and a quote.
   `applyChallenge()` can only lower: a doubt whose quote is found in the
   profile and whose reason names nothing forbidden sends the decision to
   `borderline` (a `no_fit` is never raised), caps the score at 69,
   appends the reason to the concerns and stores the challenge; a doubt
   without a quote, or with one the profile does not hold, is an opinion
   and is stored as confirmed, changing nothing. The reading puts the
   doubt first among the reservations ("Seconde lecture : …"). A call the
   model cannot answer is sent once more, then the entry keeps its first
   reading for this run.
8. **The comparative tiers** (the package's `ranking.ts`): the retained
   and borderline results, best score first, in groups of up to eight
   (`RANK_GROUP_MAX`; a last group of one takes one from the group before
   it, since one candidate cannot be compared, and fewer than two is
   nothing to compare; one profile alone left without a tier is compared
   again with the best already tiered). One call per group, with the
   brief in a few lines (title, role definition, must-haves) and one
   compact sheet per result, never the person: the decision, the score,
   the five dimension scores, the requirement rows with the required ones
   marked, the seniority note, the strengths, the concerns, the second
   opinion's reason. The model answers a tier per candidate, A (present
   now: the métier is the role, every must-have met, the second opinion
   raised nothing major), B (worth a deeper look: a real reservation to
   check; a required requirement at `unknown` or `partial` is B at most),
   C (not now: within this group the reservations outweigh what the
   profile brings next to the others), each with one line saying why
   relative to the others, and the tiers are not quotas: a group of
   similar profiles may all be A. `applyRanking()` binds it: a `no_fit`
   gets C at most, a `borderline` B at most, a `fit` at C becomes
   `borderline` (never `no_fit`: the team decides), an id the group does
   not hold is ignored, a line naming what no sentence may is withheld.
   When the tiering took several groups, one last call compares the A's
   of every group (eight at most, `finalRankGroup`), so the order of what
   is presented is one comparison and not several; a group the model
   cannot answer is settled for this run.
9. **Done**: `status = 'done'`, `finished_at`, the stage cleared, the
   progress at its total.

**While it runs**, the state block of the brief's page follows the row
(realtime on `searches`, and a read every ten seconds while the job is
queued or running; the results are read again when the status changes
and every twenty seconds while the profiles are read in full, so the
matches land as they are read). Queued, it says "En attente" over an
indeterminate bar; running, the stage's figure ("640 / 1 093 analysés"
while profiles are read, else the stage's own count), the bar of the
whole run, each stage owning a span of it so it never goes back
(`progressOf()`), and the stage's word ("Lecture du brief", "Vivier",
"Tri", "Notation", "Sélection", "Lecture", "Contre-lecture",
"Classement"). In both, "Interrompre" (`stopAnalysis`) stops a row no
processor claimed yet at once and asks a running one to stop between
two batches (what was stored stays); "Reprendre" queues the same row
again, and the run resumes where it was. Closing the tab changes
nothing, and a colleague sees the same row. A failure of the provider (its rate, a server error, the network)
is sent again after 2, 6, 15, 30 and 60 seconds, or after the
`Retry-After` it names, then fails the run; a batch the model cannot
answer is split, never retried for ever; any other error ends the run
`failed` with a short code the state block turns into one line
("Échec · Modèle indisponible", "Le poste a changé : relancez
l'analyse.", else "Analyse interrompue par une erreur") and "Réessayer".
Nothing retries by itself.
A SIGTERM on the processor (a redeploy) lets the batches in flight end
and leaves the row running: the next boot claims it at once; a crash
leaves a row the scan claims once its heartbeat is two minutes old. A
run reads the pool as it was when its snapshot was taken (a resumed run
adds the profiles gained since); "Relancer" on a finished analysis
starts a new one on the pool as it is now. Every write-back of results
is one statement (`merge_search_results()`: the row locked, each entry
of the batch replacing the entry of the same candidate, the others
appended, the counts recomputed), so calls in flight together add up.
Every call of a run goes to `LLM_ANALYSIS_MODEL` and is one `ai_usage`
row for the organisation (`brief`, `triage`, `screen`; `assess` for the
full readings, the second opinions and the tiers), a failed call too
when its error carries what it billed; the run's model is written on
the row (`searches.analysis_model`).

**The brief page** (`/app/briefs/:briefId`) is one plane in three
panes (the layout in `docs/DESIGN.md`, "Page templates"). The header
carries the way back, the title, the status when it is not simply open,
the date of the last change, the one filled button ("Analyser", then
"Relancer"; "Analyse en cours" while one runs; outline while the state
block carries "Reprendre" or "Réessayer", while the empty matches carry
"Analyser", or while the shortlist's "Partager la shortlist" is the
filled one), the thread's toggle and a menu (the full text, the form,
the shares, close or reopen, delete for administrators). The list pane
holds the brief folded to two lines, with "Voir le brief" and
"Modifier" (the title, the text and the status in a drawer: a text
change says "Brief modifié · relancez" until the next run, and the
row's hash says it for a colleague's edit too, `briefChangedSince()`),
then the state block, then the profiles in four groups, the group and
the selected profile kept in the URL (`?g=`, `?c=`; the old
`?tab=shortlist` still opens the shortlist). One analysis per brief is
on screen, the newest: a newer one a colleague starts takes its place,
and the earlier rows stay in the database with no menu to reopen them.

- **The state block** (`AnalysisState`; `bandStateOf()`,
  `src/lib/briefs/presentation.ts`), one status region in every state,
  figures first. Done: the matches as the figure ("12 correspondances")
  and one line, "1 091 analysés · 4 min" (the profiles the run analysed
  and how long it took); a run whose full readings failed for some
  profiles says how many, with "Reprendre"; no match once everything
  ran, the requirement most often missing. Queued, running, stopped
  ("Interrompue · 640 / 1 091" and "Reprendre") and failed as above. An
  analysis stored before the whole pool was read says how many of the
  pool it read ("Analyse antérieure · 84 profils lus sur 1 091"); one
  run on the text alone, before evolution 7, says "Texte seul, sans
  modèle" (or "sans exigences") over the head of its ranking, twenty
  rows. An empty pool says "Vivier vide", with the way to the import.
  No funnel, no tier counts: the four groups carry the figures.
- **The groups**, a segmented control with their counts, each a list of
  56px rows with the photo or the initials. **Correspondances**: the
  matches alone (`fit`), tier then score; the rank, the name, the
  position, the years and the place, the tier letter (`TierPill`: A an
  ink disc, B an ink outline, C a grey outline) or "À confirmer" while
  the second opinion has not seen the match, and beside the row the
  shortlist button (a check once added). **Proches**: the ones the full
  reading found `borderline` first, then, fifty at a time
  (`listScreened()`, best first, under RLS), the ones the screening
  scored but the promotion did not take, each with "Lire quand même".
  **Shortlist**: the shortlist's items ("Shortlists" below).
  **Écartés**: every profile set aside, on demand, fifty at a time (set
  aside after the full reading, closest first, with the must-have at
  `no`, else the main reservation; set aside by the triage, with the
  model's reason, "Non lus" for a card it could not read), marked once
  as the model's reading, with "Lire quand même" where no model read it
  in full. A member may have any profile the triage or the screening
  left out read in full anyway ("Lire quand même", `readAnyway`: its
  `search_triage` row becomes `close` and `forced`, with no reason of
  the model's; a run that had ended is queued again and the promotion
  always takes a forced row, one under way reads it at its next step),
  since a person decides, not the model. Rows rise in as their batch
  lands and never again.
- **The reading** of the profile selected (from `lg` the first of the
  group when the URL names none; below `lg` a tap opens it full
  screen): the photo or the initials, the name, one line of what the CV
  states ("Directeur commercial chez Label'Vie · 12 ans · Casablanca ·
  Disponible sous 3 mois", "Non renseigné" when it states none of it),
  the tier, the score as a plain figure ("82 / 100") and "Lecture du
  modèle" (on the shortlist, who decided and when); for a member
  "Retenir" and "Écarter" (one click: a match enters the shortlist with
  that decision), then "Voir le CV" and "Voir la fiche"; then why this
  profile (the tiering's note first, then the reading's summary, with
  the count of sentences the filter withheld), the requirements with
  their evidence (the role first, an unverified quote marked, what the
  CV does not state "Non renseigné"), the five dimensions as meters with
  the composite's make-up and the model's own score behind an info icon,
  the strengths, the reservations (the second opinion's doubt first),
  the interview points, and the triage's verdict, small and muted. The
  thread pane beside it holds the brief's thread, or a shortlisted
  candidate's (a segmented control at its top switches between the
  two). The `why` sentences of analyses stored before evolution 2
  (`ai_usage` kind `explain`) are still read where present; nothing
  writes them any more.

**Strict presentation.** What the page lists is what the team could
send as it is, and nothing else. A profile is a match only when the model
read its métier as the role with a quote found in the CV and scored that
dimension 70 or more (`ROLE_DIMENSION_FIT_MIN`), every required
requirement is met with a quote found in the CV, the composite reaches
75 (`FIT_MIN_SCORE`) and the second opinion raised no grounded doubt; the
tiering orders the matches (A before B) and sends a match it puts at C
to the near profiles. Everything the rules can only hold back is a near
profile (an adjacent métier, a métier under 70, a composite between 45
and 74, a must-have not stated or met in part, a doubt with evidence, a
tier C), and a role at `no`, a must-have at `no` or a composite under 45
is set aside, counted and listed only on demand. So a pool with no
match reads "0 correspondance" once every stage ran, with how many
profiles were analysed and the requirement most often missing; while
a run goes, a group with nothing landed yet says "Analyse en cours",
never "none". The thresholds are the exported constants of the
package's `assessment.ts` (re-exported by `src/lib/briefs/assessment.ts`),
each tested at its boundary in `assessment.test.ts`.

**What the shortlist and the dossier carry.** The whole reading
(`Assessment`: the rows, the dimensions, `strengths`, `concerns`,
`questions`, `tier`, `rankNote`, `challenge`, `modelScore`, `withheld`)
travels as JSON inside `searches.results` and `shortlist_items.match`,
no column change; every field is optional, so an assessment stored before
evolution 3 reads as before and the pages show nothing of what it lacks.
An item added to the shortlist holds the match of that moment: the
screening is carried to an item added before its batch returned (the
server fills an unassessed match only), the second opinion and the tier
are not carried afterwards. A shortlisted candidate's row shows the
tier letter beside the name; the reading shows the recruiter's reading
(`src/lib/shortlists/requirements.ts`, `recruiterReadingOf()`): the line
the tiering wrote for this rank, the dimensions, the strengths, the
reservations with the second opinion's doubt marked as the second
reading, the interview points and the requirement rows; the score is a
figure in its head. The dossier (`src/lib/shares/draft.ts`) takes a
sheet's strengths from the reading's, its attention points from the concerns
with the doubt as one more point, and its **questions** (up to five,
`ShareItem.questions`) from the reading's, shown on the sheet under
"Points à vérifier en entretien" only when there are some; the sheets go
out as the shortlist stores them (the one-step dialog asks the model for
nothing); an assessment without a reading falls back on the requirement
table as before, and a share made before the questions existed has none.

**What an analysis costs.** Every call is the processor's, on
`LLM_ANALYSIS_MODEL`. The reading of the brief is one `brief` call per
brief (the text clipped to 12 000 characters in, 3 200 tokens out at
most), made again only when the title or the text changed. Then the
triage is one call per forty profiles of the pool, about 16 000
characters in at most and a budget of 600 tokens plus 110 per card out
(5 000 for forty); a call the model cannot answer is read again in
halves. Then the screening is one call per twenty-five profiles kept
(the same cards, 400 tokens plus 90 per card out). Then the thirty best,
and every profile a person forced in, are read in full, one `assess`
call each of about 9 000 characters in and a budget of 1 800 to 3 200
tokens out, growing with the number of criteria (the five dimensions,
the three lists and one row per criterion). A retained profile takes a
second call (the same input, 400 tokens out). Each group of up to eight
retained or borderline profiles takes one tiering call (a few thousand
characters of sheets, 120 tokens out per candidate), and the A's of
several groups one final call. So a pool of 1 000 profiles of which 150
are kept is 25 triage calls, 6 screening calls and 30 full readings,
then at most 30 second opinions and 5 tiering calls: a hundred calls at
most, whatever the pool holds beyond the thirty best, and `ai_usage`
records each one for the organisation with the model that answered.

## Shortlists

One shortlist per brief (`shortlists.brief_id` is unique), the
Shortlist group of the brief's page (`/app/briefs/:briefId?g=shortlist`),
created on the first profile a member puts on it (`ensureShortlist()`;
a viewer reads what exists). An item carries the match as a snapshot
(`shortlist_items.match`: the verdicts, the assessment when the model
answered, and the criteria of that analysis, so the table is read
against the right brief whatever the brief becomes). An item added
before its batch returned receives the assessment when it does (members
insert a match, never update one; the server fills only an unassessed
one). The old addresses still work: `/app/shortlists` goes to the
briefs, and `/app/shortlists/:id` reads the shortlist's brief under RLS
and goes to its Shortlist group.

A match enters the shortlist in one click: the button beside its row
adds it to examine, "Retenir" and "Écarter" in its reading add it with
that decision (`addWithStatus()`: the insert, then the status as a
second write, so the database stamps who and when as for any decision;
a profile already there keeps the decision it has). The Shortlist group
lists the items as rows under a filter (Tous, À examiner, Retenus,
Écartés, each with its count): the photo or the initials, the name, one
line (the position, the years, the score, then who decided, "Sara B.
retient", else "à examiner"), the tier letter and the decision as a
pill (Retenu, the ink filled with a check; Écarté, a grey outline with
a cross, the row muted; À examiner, an ink outline), and for a member
the decisions that apply as icon buttons beside the row (Retenir and
Écarter, or Réexaminer a decided one) and the item's thread with its
count. A decision shows at once as the person's own and the next read
confirms it. Selected, the item reads in the reading pane with who
decided and when, its decisions (the one taken becomes "Réexaminer")
and the recruiter's reading; its thread is the thread pane's. Once
someone is retained the header's one filled button is "Partager la
shortlist" (the run button turns outline on this group); the shares
made from the shortlist are in the header's menu ("Partages (N)").

- **Decisions**: a member retains, dismisses or reviews again. The
  database stamps `decided_by` and `decided_at` from the session; the
  reading says "Retenu par Ana" with the date and the time from those
  columns, never from the browser.
- **The thread**: one per shortlisted candidate
  (`comments.shortlist_item_id`), the team's dialogue with `@` mentions
  over the members (`comments.mentions`, member ids read from the final
  text), live; a message is deleted by its author or an administrator.
  The brief and the candidate have threads of their own ("The team
  thread").
- **Decision trace**: every change is a row in `activities`, written by
  database triggers (`shortlist.added`, `shortlist.removed`,
  `shortlist.status`, `shortlist.assigned`, `comment.added`), read at
  `/app/activity`; the per-item history panel is gone.
- **Gone from the interface**: the votes and the shared note per item
  (evolution 6), the assignment and the removal of an item (evolution 7
  part B: a profile is dismissed, not removed). The `votes` table,
  `shortlist_items.note` and `shortlist_items.assigned_to` stay in the
  schema with their grants; nothing reads or writes them any more (the
  migration that drops them is not written).
- **Realtime**: `shortlist_items` and `comments` (with `votes`,
  `documents`, `activities`, `briefs`, `shortlists` and `searches`) are
  in the `supabase_realtime` publication with full replica identity; the
  brief's page subscribes under RLS and debounces changes into one
  re-read.

Viewers read the shortlist; members write; the buttons follow the role
and RLS checks again.

## The team thread

Almost every object carries the team's dialogue, one component for every
screen (`src/components/thread`, `src/lib/threads`), in the thread pane
of the page that shows it (`ThreadPane`, opened by the header's toggle;
a sheet on a phone): a brief, a candidate (on the pool beside the
selected profile, and on their page), a shortlisted candidate (on the
brief's page, where a segmented control at the top of the pane switches
between the candidate's thread and the brief's). A thread is the
`comments` table with one of `brief_id`, `candidate_id` or
`shortlist_item_id` set (the schema's check, unchanged since evolution
1, like its policies: members read, a member inserts as the author, the
author or an administrator deletes). `TeamThread` reads the last hundred
messages newest last with their authors' profiles (a member who left
reads "Un ancien membre"), groups them by day, shows what was just sent
at once and confirms it on the next read, announces what arrives (a
polite live region), and offers a composer where Enter sends, Shift+Enter
breaks a line and "@" completes the team's names
(`src/lib/shortlists/mentions.ts`). Every change of the object's column
re-reads (`subscribeThread`, Realtime on `comments`). The dashboard's "À
traiter" lists the messages that mention the person (`listMyMentions`,
the object each is about named: the brief's title, the candidate's
name), and the briefs list says who wrote last on each brief and when,
the dashboard who and the first words (`threadSummaries`). The pure
helpers are tested (`src/lib/threads/thread.test.ts`).

## Sharing: the dossier

A shortlist is shared as a **dossier** the hiring manager opens without an
account (`/share/<token>`, `src/routes/share/$token.tsx`, outside the app
shell, in the sharing organisation's language): a cover with what was
looked for, an overview of the profiles, then one sheet per candidate.

- **The share** (`shares`, members, rate-limited, `src/lib/shares`), in
  one step: the dialog lists the shortlist's candidates (the retained
  ones ticked), takes the addresses the link goes to and a message for
  them (both optional, and off when this deployment has no email
  sender), and one filled "Partager" does the rest: the server drafts
  one sheet per candidate from the profiles and the reading the
  shortlist stores (`draftShare`, no model call: the dialog asks for
  none), creates the share (its link shown this once, with a copy
  button) and emails it when addresses were given ("Envoyé à N"). The
  row holds the brief's title as the dossier's, up to thirty candidates
  as a snapshot (`items`), the CVs included, and an expiry of fourteen
  days (`DEFAULT_EXPIRY_DAYS`; the server accepts 1 to 30). Each item
  holds the facts the CV states (name, headline, location, years of
  experience, availability, the first skills, the languages), the
  **requirement table** (one row per requirement: met, in part, not met,
  or not stated, with the evidence quoted from the CV), the fit
  **score** and **decision** when a model assessed the profile, a
  synthesis, strengths, points of attention, interview questions, and
  the latest processed CV. No photo is reproduced: a profile is
  identified by its name (the dialog's avatars are the team's view,
  never sent). Each sheet marks once that its synthesis and its points
  are the model's reading; without an assessment, strengths are the
  requirements met and attention points the ones not met or met in
  part, and a profile the shortlist never analysed says so rather than
  showing an empty table. `draftShare` keeps the option of one model
  call that rewords the prose (`ai_usage` kind `summary`); no screen
  asks for it.
- **The brief's snapshot** (`shares.brief`: title, description clipped,
  requirements with their required flag) is taken by the server from the
  shortlist's brief when the share is created, never from the browser; the
  cover shows it as "what we looked for" whatever the brief becomes later.
  A share created before this column reads as a dossier without a cover
  brief, and says so.
- **The token** (32 random bytes, base64url) is shown once, in the link,
  when the share is created. The row holds its SHA-256 only
  (`shares.token_hash`, not granted to the browser); the page hashes the
  token it receives and reads the share with the service role. The
  browser keeps the links it created in `sessionStorage`
  (`src/lib/shares/link-memory.ts`: the newest fifty, gone with the tab,
  sent nowhere), so the shares' drawer can copy them again; a
  link created elsewhere cannot be shown. `shares` is written by the
  server only: the browser has no insert or update grant.
- **Expiry and revocation**: `expires_at` is checked on every open and
  the page says when the link stops working; `revoked_at` ends a share at
  once (a revoked link says so even after its date). Opens are counted
  (`view_count`, `last_viewed_at`, best effort) and the shares of a
  shortlist are listed in a drawer of its brief's page (the header's
  menu, "Partages (N)") with their date, who shared, how many
  addresses, their state, a copy button for a link this browser created
  and a revocation in the row's menu.
  `share.created`, `share.sent` and `share.revoked` go to the activity
  log.
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
  printed page; "Imprimer" is the browser's print, and the
  footer says the analysis proposes a reading and a person decides. There
  is no server-side rendering.

## Model

The model sits behind any OpenAI-compatible API, chosen per deployment with
four variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`LLM_EMBEDDING_MODEL`), read by the Worker (`src/lib/model/model.server.ts`)
and by the processor (`services/processor/src/model.ts`) with the same
conventions, plus one the processor alone reads (`LLM_ANALYSIS_MODEL`):

- **Mistral** is the recommended vendor (European hosting):
  `LLM_BASE_URL=https://api.mistral.ai/v1`, `mistral-small-latest` and
  `mistral-embed` by default when the base URL is Mistral's.
- **OpenAI** works with `https://api.openai.com/v1`, `gpt-4o-mini` and
  `text-embedding-3-small` (shortened to 1024 dimensions by the API).
  Anthropic through a gateway, Groq, Together, OpenRouter and a local Ollama
  expose the same chat and embeddings calls.
- **Every call of an analysis is the processor's**, and the browser never
  calls a model: the one reading of a brief, the triage, the screening,
  the full readings, the second opinions and the tiers run in the job
  (`services/processor/src/analysis`), on `LLM_ANALYSIS_MODEL`, another
  chat model of the same endpoint when set and `LLM_MODEL` otherwise.
  The full reading is where the product's worth sits (does this CV
  answer this brief?), and the triage and the screening judge the métier
  from what the person did, so when budget allows set it to a stronger
  model such as `mistral-medium-latest` and keep `mistral-small-latest`
  for the structuring; `ai_usage.model` and `searches.analysis_model`
  record which one answered. The Worker's model serves `/status`, the
  brief page's "a model is set up" (`briefCapabilities`) and the dossier
  draft's option; `LLM_ASSESSMENT_MODEL` on the Worker is read for
  `/status` only, and `completeJson({ model })` keeps the way to name a
  model for one call, which nothing uses.
- **Embeddings are 1024 wide** (`EMBEDDING_DIMENSIONS`, the width of every
  `vector(1024)` column). A model answering another width is refused with a
  sentence naming the variable to change; the processor probes the model
  once at start and shows the state on `GET /health` (`embedding`).
- **Every answer is JSON**, validated with a zod schema, one retry quoting
  the validation error, then an error, never a partial object.
- **Usage is recorded** in `ai_usage` per organisation and kind
  (`structure`, `embed`, `ocr`, `brief`, `triage`, `screen`, `assess`,
  `summary`; `explain` for rows written before evolution 2) with the
  model and the tokens; administrators read it. An analysis costs one
  `triage` call per forty profiles of the pool, one `screen` call per
  twenty-five profiles kept and one `assess` call per profile read in
  full (thirty at most, plus the ones a person forced in), then the
  second opinions and the tiers ("What an analysis costs").
- **Rate limits**: every server function that calls the model, sends an
  email, creates a share, pokes the processor or queues an analysis is
  behind `enforceRateLimit(scope)` (scopes `model`, `email`, `share`,
  `processor`, `search`; `triage` and `assess` stay declared and count
  per user alone, nothing uses them since the analysis left the Worker):
  60 calls per minute per client and per scope (the address, an IPv6 by
  its /64, and the user id as a second bucket). An analysis spends
  `search` once per click ("Analyser", "Relancer", "Reprendre", "Lire
  quand même"); its model calls are the processor's, paced by
  `ANALYSIS_CONCURRENCY` and the provider's own answers (a refusal is
  sent again after 2, 6, 15, 30 and 60 seconds, or the `Retry-After` it
  names), never by this throttle. A throttled call answers
  `RATE:limited` and the page says to try again in a minute. People
  behind one office address share that address's bucket.
- **Without a key** on the processor an analysis fails at its claim
  (`model_unavailable`, "Échec · Modèle indisponible" on the brief's
  state block, "Réessayer") and the processor structures by heuristics
  and sets nothing aside;
  without a key on the Worker `modelConfigured()` is false, `/status`
  says so, dossiers are written from the verdicts, and an analysis stored
  on the text alone before evolution 7 reads "Texte seul, sans modèle".
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
  of their documents and their photo are removed from the buckets first,
  then the row (the
  cascade takes documents, shortlist items and comments; the trigger logs
  `candidate.deleted`). A candidate whose files could not be removed waits
  for the next pass: a row never outlives its files.
- **Consent**: `consent_status` is `unknown`, `given` or `withdrawn`, with
  `consent_at`; withdrawing is confirmed first because the purge then
  deletes the profile within the hour.
- **Export**: the profile page builds one JSON file in the browser from the
  rows the person can read (the profile and its documents with the text
  extracted from each CV and, when the profile carries a photo, a signed
  link to it valid one hour; never `fingerprint` or `search_text`).
- **Erasure**: an administrator types the candidate's name; the server
  (`eraseCandidate`) removes the CV files and the photo, deletes the row
  and logs who did it.
- **Audit log**: `activities`, written by triggers and server functions,
  read by every member at `/app/activity`.
- **Team threads**: the messages on a brief, a candidate or a shortlisted
  candidate are `comments` rows. A candidate's erasure takes the messages
  on them and on their shortlist entries (cascade); a brief's messages go
  with the brief; a message on a brief's thread that names a candidate
  stays with the brief (`docs/RGPD.md` says what to do with it).
- **Never extracted**: age, date of birth, gender, nationality or origin,
  family situation, health, religion, union membership, political
  opinions. Not as fields, not as criteria, not in assessments or dossiers;
  the triage and screening cards carry no name, contact detail, place,
  link or CV text, and the full reading's payload no name, e-mail or
  phone; every call of an analysis is the processor's.
- **The photo**: the one thing kept that a CV carries beyond its text, as
  a file for identification in the interface only (`photos` bucket,
  `candidates.photo_path`): never sent to the model, never on a dossier,
  off for an organisation with `show_photos`, erased with the candidate,
  linked from the export.
- **Accounts**: a person deletes their own account from `/app/settings`
  ("Mon compte").

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
  `vivier`, Dockerfile `services/processor/Dockerfile` (the image builds
  the shared package `packages/analysis` and ships its `dist/`), watch
  paths `services/processor/**` and `packages/analysis/**`, health check
  `/health`. Variables as in the table above; `PORT` is Railway's. After
  the first deploy, the logs show `polling: true` and, with a model,
  `embedding_ok`; `/status` sees it. A redeploy runs the embedding probe
  again and claims the analyses the stopped process left. A stop sends
  SIGTERM: the documents and the analysis batches in flight get 25 s,
  the rest goes back to the queue, and a run left running is claimed
  again at the next boot. Evolution 7 moved the analysis here: deploy
  the processor (after the migration) before the Worker that queues the
  rows, since a processor built before it never claims them and the
  brief's state block would wait on "En attente".
- **Database**: migrations are applied to the Supabase project before the
  code that needs them is deployed. Evolution 7 part B is the Worker and
  one migration: `20261016090000` first, then the Worker; the processor
  does not change.

## Validation

- Frontend: `bun install --frozen-lockfile`, `bun run build` (generates
  `src/routeTree.gen.ts`, which the typecheck imports), `bun run typecheck`,
  `bun run test` (Bun 1.3.9, Node 22).
- Processor: `npm install` (`npm ci` once `package-lock.json` is
  committed), `npm run typecheck`, `npm test`, `npm run build` from
  `services/processor` (each builds the shared package `packages/analysis`
  first); `docker build -f services/processor/Dockerfile .`
  from the repository root; `GET /health` answers 200.
- CI: `.github/workflows/ci.yml` runs the `Vivier frontend` and
  `Vivier processor` jobs on every pull request. Each job checks only when
  its paths changed (`packages/analysis/**` counts for both: the frontend's
  vitest runs the package's tests, the processor builds it) and reports
  green in seconds otherwise, so both checks
  can be required in the main branch ruleset. The processor job builds the
  production image and checks `/health` before the image is trusted. No
  secret, no production call; it never deploys or merges.

## Backups

Supabase's Point-in-Time Recovery is the primary line; a nightly workflow
(`.github/workflows/backup.yml`, `scripts/backup.sh`) adds a logical
dump of the database and a copy of the `cvs` bucket (not of `photos`: a
restored profile whose photo is gone shows initials) to an R2 bucket, kept
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
  then CI and the Dockerfile install from the ranges in `package.json`
  (unpdf 0.12.2 at least, the floor the photo needs).
- **Votes, notes and assignment**: the `votes` table and
  `shortlist_items.note` have had no interface since evolution 6, and
  `shortlist_items.assigned_to` none since evolution 7 part B; nothing
  writes them, and the migration that drops them is not written.
- **Photos**: nothing replaces or removes a candidate's photo short of
  erasing the candidate; a wrong one (a logo the rules took for a
  portrait) stays until then. The maintenance pass gives a candidate
  read before evolution 4 theirs from their newest CV with a text layer,
  once; one whose CVs are all scanned, or typed by hand, gets one from
  the next CV with a portrait. The `photos` bucket is not in the nightly
  backup.

## Contributing

Rules of the road live in `AGENTS.md`; how a feature is laid out and the
helpers every feature uses in `docs/CONVENTIONS.md`; how a screen looks
and moves in `docs/DESIGN.md`. One branch and one
pull request per evolution, never a push to `main`, CI green before a
merge, no new dependency without the owner.
