# Vivier

Vivier is the collaborative talent pool for HR teams: upload the CVs you
receive (up to 10 000 in one import), let a model read them into structured
profiles, analyse the whole pool against a brief in one click (the model
reads the consultant's text once, sorts every profile by métier, reads the
kept ones in full with the evidence quoted from each CV, challenges and
tiers them), build a shortlist as a team (decisions, assignment, a thread
with @mentions on every brief, candidate and shortlisted candidate) and
send the hiring manager a dossier by email: one sheet per candidate, the
requirement table on each, printable. Every decision is a person's, every
page says what it knows and what it does not, and each organisation sets
how long its candidates are kept. The interface is black and white (the
Blackweaver charter, v3: one ink on paper, a state told by a shape and a
word, never a colour).

- **Product name**: "Vivier" (a vivier is where talent grows). Name, tagline
  and description live in `src/lib/brand.ts`; the mark is drawn inline in
  `src/components/brand-mark.tsx`. The interface speaks French and English
  (`src/lib/i18n`, one dictionary per feature, `en` must carry every key of
  `fr`, tested).
- **Fonts**: Geist, Geist Mono and Poppins 600, self-hosted from
  `public/fonts/` under the SIL Open Font License. No third-party stylesheet.
- **Design**: `docs/DESIGN.md` is the charter every screen follows (v3, Blackweaver monochrome:
  the principles, the tokens of `src/styles.css`, the primitives of
  `src/components/ui` and `src/components/app-shell`, what moves and why,
  the icons, the content rules, the page templates).
- **Where it lives**: its own repository, `tnaoufal/vivier`, apart from
  Namearly; the two share a stack and nothing else.

## Principles

These four rules are enforced in the schema, the server functions and the
pages, not only promised:

- **No machine decision.** The model structures CVs, reads a brief once
  into a role profile and requirements (the consultant's text is the only
  source; nobody checks or edits that reading), sorts the pool by métier
  and assesses each profile it kept against the requirements with a
  reading (`fit`, `borderline`, `no_fit`) that rules bound and a person
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
| Data      | Supabase (`supabase/migrations`)            | Postgres 17 with Row Level Security on every table, Auth (email + Google), Storage (the private buckets `cvs`, PDF only, 25 MB, and `photos`, PNG or JPEG, 2 MB), Realtime on the collaborative tables, pgvector (HNSW, cosine) for hybrid search. EU region.                                               |
| Processor | `services/processor`                        | Node 22 + Fastify 5 on Railway with the service role key: reads queued PDFs, sets aside what is not a CV, structures the rest (model or heuristics), finds the person already in the pool (email, phone, fingerprint), reads the candidate's photo off the first page, computes embeddings, and runs the hourly maintenance (stale reset, retention purge, re-embed). Documented in `services/processor/README.md`. |
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
snapshot and the dedup columns, the pool size of an analysis),
`20261014090000` evolution 3 (`briefs.role_profile`), `20261014130000`
evolution 4 (`candidates.photo_path`, `organizations.show_photos`, the
`photos` bucket), `20261015090000` evolution 5 (`search_triage` and its
three functions, the summary counts of `searches`) and `20261015120000`
evolution 6 (`seniority_band()`, and `similar_candidates()` answering the
neighbour's years, seniority first). Then enable
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
| Read candidates, documents, briefs, analyses, shortlists, threads, activity, shares, similar profiles |   x    |   x    |   x   |   x   |
| Upload CVs, add or correct a candidate, archive, set consent, put a failed or set-aside document back in the queue |        |   x    |   x   |   x   |
| Create and edit briefs, run analyses                                                             |        |   x    |   x   |   x   |
| Add to a shortlist, retain or dismiss, assign, write in a thread (delete own messages), share and send |        |   x    |   x   |   x   |
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
it (no column grant). The plan card on the team page (`/app/members`) is
read-only.

## The shell and the dashboard

Four entries in the sidebar (Tableau de bord, Briefs, Vivier, Équipe)
with one ink mark that slides to the current one; the organisation
switcher above them, the plan as a quiet line under its name; the person
at the bottom, whose menu holds Réglages (`/app/settings`), the theme, the
language, the organisations and the sign-out. On a phone the same sidebar
is a full-screen sheet. `/app/account` only redirects to the settings (a
password-reset link still lands there, and the password dialog opens by
itself). The team page (`/app/members`, "Équipe") holds the members and
their roles, the invitations, the plan card and the one filled "Inviter";
a quiet link leads to the activity log (`/app/activity`). The settings
(`/app/settings`, "Réglages") hold the organisation (name, working
language, retention, the photos switch) for administrators, "Mon compte"
(display name, language, theme, password) for everyone, and the danger
zone (leave the organisation, delete it, delete the account).

The dashboard (`/app`) says what asks for the person, figures first: a
greeting and the date, one filled button, "Nouveau brief" (the import
while the pool is empty); "Mes briefs en cours",
the open briefs as rows (what the newest analysis found, "3 retenus", the
thread's last message with who wrote it and when), the most recently
active first (`src/lib/activity/overview.ts`, read off the searches'
summary columns and the shortlist items' status, never the results); "À
traiter", the messages that mention the person, each leading to its
object; and one line for the pool ("1 091 profils · 12 CV en traitement",
with a bar while CVs are read) and "Importer des CV", which opens the
pool's import dialog (`/app/candidates?import=1`). No stat tiles, no
activity feed: the log is at `/app/activity`. Everything re-reads when
the briefs, the searches, the shortlist items, the comments or the
documents change.

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
CV's images are not read. The photo identifies a person on screen and
nothing else: it never enters a prompt, is never read for anything, and
no column of the profile comes from it. Members see it through signed
links of ten minutes, cached per session (`src/lib/candidates/photos.ts`);
the `Avatar` keeps the initials until it loads and when it fails. An
administrator turns the display off for the organisation on the settings
page (`organizations.show_photos`, for a team that practises anonymous
CVs); the dossier never shows it. The purge and the erasure remove it
with the CVs; the export carries a link to it valid one hour.

The list (`/app/candidates`) shows what tells rows apart, not every
field: one 64px row per profile with the photo or the initials, the name
and the position held today (`currentPosition()`: the first experience
without an end, else the headline), one quiet line that reads the
seniority first, then the place, then the three skills the CV put first
(`listLine()`: "12 ans · Casablanca · Python, SAP, MS Project"; a fact
the CV does not state is simply absent from the row, the sheet says "not
stated"), the last update on the right from `sm`, and the one pill that
sets a row apart (archived, listed on demand). The header carries the
pool's figure (the profiles, and the CVs being read while a wave runs)
and the one filled action, the import; a person typed in by hand waits in
the header's menu. One toolbar: a search over the name, the headline and
the location, a sort (recent, name, seniority; a second key on every
sort, so a row never shows on two pages) and a "Filtrer" button whose
popover holds the filters (the location contains, the years at least,
one skill as the profiles write it with the page's skills suggested, a
tag when the page holds some, and "Afficher les archivés"), their count
on the button. `?import=1` opens the import dialog once (the dashboard's
"Importer des CV" leads there). A row reads `experiences` whole and
`photo_path`, never `search_text` or `fingerprint`
(`CANDIDATE_LIST_COLUMNS`).

The profile page (`/app/candidates/:id`) is laid out like a CV a
recruiter reads, the team's thread beside it: a sticky header with the
way back, the name, one line (the position held today, the years, the
place), one filled action ("Voir le CV") and a menu (edit, similar
profiles, export, archive, erase); the head of the CV as a card (the
photo in greyscale, the name, the position, the seniority first, the
languages as quiet text, the pills that set the profile apart), then the
summary on three lines, the career as a timeline with each period and
its duration computed (`formatDuration()`: nothing estimated when a date
is not one), the education, the skills (eight, the rest behind "+ N"),
the contact details and the links; under them the documents, the team's
tags and the consent folded behind its one line. From `lg` the team's
thread on the candidate is the right column (`TeamThread`, with
@mentions, live); on a phone it is a drawer the header's button opens.
Every field the structuring read, with a confidence hint where it was
unsure and "not stated" where it read nothing; a form in a drawer
corrects it (the browser may update the human-readable columns;
`fingerprint`, `search_text`, `embedding`, `confidence` and `photo_path`
are the processor's). **The CV is read in place**: "Voir le CV" opens the
newest processed document (else the newest, `primaryDocument()`) in a
full-size drawer, the PDF in a frame from a signed link of fifteen
minutes with a toolbar (the file, its size, pages and date; a PDF / Text
switch; open in a new tab; download under the file name), and the text
the service extracted as paragraphs, read on demand
(`readDocumentText()`), which is the view a browser that displays no PDF
opens on (`canDisplayPdf()`); each document in the Documents card has its
own "Lire" button. **Similar profiles** (every role, in the menu) opens a
drawer listing the ten profiles nearest this one, seniority first:
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
spoke. A reading aid for a person who compares, never a verdict. The page
is live through Realtime on the candidate's `documents`; the thread
follows its own messages.

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
else: one centred card, "Créer et analyser", and the brief page opens
with `?run=1` and starts the analysis at once. The list of briefs shows
each one with its status when it is not simply open, what its newest
analysis found (`readLatestAnalyses()`, read off the counts of its row,
never its results: "12 correspondances", "Analyse inachevée", "Aucune
analyse"), how many candidates its shortlist retained, who wrote last on
its thread and when, and when it changed, behind a filter (open, closed,
all) that appears once a brief is closed; the dashboard shows the open
briefs the same way.

**The brief is the only source of the analysis, read once by the model.**
`runSearch` reads it in one call when the brief was never read or its
text changed since (`needsDerivation()`: no `briefs.role_profile`, or its
`sourceHash` differs from `briefSourceHash(brief)`, FNV-1a over the
title, a line break and the text; a profile stored before the hash
existed is read again once). The call (`readBriefPrompt`, temperature 0,
`LLM_MODEL`, `ai_usage` kind `brief`, 3 200 tokens out at most) answers
one JSON with the **role profile** and the **criteria**, bound by
`enforceBriefReading()` and saved into the brief in one write
(`briefs.role_profile`, `briefs.criteria`), so a search never reads one
without the other. Nobody checks or edits the reading: there is no
criteria editor, no proposals, no profile card and no check step; the
requirements appear where they matter (the requirement rows of each
profile's reading, the dossier's table) and the profile stays internal.
A brief read before whose reading fails answers the error rather than an
analysis resting on another text; one never read goes on without it,
logged. Without a model nothing reads the brief.

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
from. Every payload reads it: the triage, the screening (the seniority
and the context judged against it) and the tiering (its must-haves). A
damaged column reads as no profile, never a crash (`parseRoleProfile()`).

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
out (the profile's title then stands for the job). A brief read again
from a changed text defines the job otherwise than the search's role
criterion (`roleChangedSince()`): the next batch answers
`INPUT:job_changed`, and the header's button runs a new analysis.

An **analysis** (`runSearch`, members, rate scope `search`) reads the
brief when it has to, takes the pool, and the browser drives the stages
on it at once (`src/lib/briefs/stages.ts`, pure: what each stage still
has to send is read off what is stored, so "Reprendre" picks up where an
analysis stopped):

1. **The pool**. With a model, criteria and a job to name (the role
   profile's title, else the role criterion's label, else the brief's
   title), **every active profile is read**: `runSearch` stores the
   search (`searches.method = 'triage'`, no results yet) and a snapshot
   of the pool (`start_triage()`: one `search_triage` row per active
   candidate, verdict null, in one statement, so `searches.pool_size` and
   the rows to read are the same set); nothing is retrieved, embedded or
   scored. Without a model, or for a brief without criteria, the **text
   path** stays (and without a model nothing reads the brief, so a brief
   never read has no criteria and the order is the retrieval's alone): up
   to 200 active candidates (`FULL_POOL_MAX`) the whole pool is read,
   newest first, so no profile is left out by a ranking.
   Above that, **retrieval** in the database (`search_candidates()`,
   SECURITY INVOKER so the caller's RLS applies): full text over
   `candidates.fts` (unaccented, `simple` dictionary so French and English
   both work, the brief's terms joined with OR) and, when the brief could be
   embedded, cosine similarity over the HNSW index, fused by **reciprocal
   rank fusion** (`1/(60 + rank)` from each list), the 120 best rows
   returned (`RETRIEVAL_LIMIT`) and the rest not looked at. `searches.method`
   records `hybrid` or `text` and `searches.pool_size` how many active
   profiles the pool held, so the page says how many it ranked out of
   the pool instead of claiming every profile was read.
2. **The triage by métier** (`triageCandidates`, members, rate scope
   `triage`, `src/lib/briefs/triage.ts`, pure, tested), whole-pool
   searches only: forty profiles a call (`TRIAGE_BATCH_MAX`), four calls
   in flight (`TRIAGE_CONCURRENCY`), the way a senior recruiter briefs a
   sourcer. Each profile is a compact **card** (`triageCard()`): the
   headline, the position held today, four earlier ones with their
   periods, the total years, the first degree without its year, twelve
   skills; never the name, the contact details, the place, a link, the
   photo, the summary or the CV text, and the name, e-mail, phone, place
   and links are taken out of the card's texts too. The cards of a call
   shrink one level at a time (the skills first, then the degree, the
   earlier companies, the earlier positions; the headline and the current
   position last, since they decide the métier) until the message stays
   under 16 000 characters (`triagePayload()`). The job is the role
   profile (title, domain, level, equivalent titles, adjacent profiles,
   six missions, six must-haves), else the role criterion and the brief's
   title (`triageRoleBrief()`). The model (`LLM_ASSESSMENT_MODEL`,
   temperature 0) answers one verdict per card with a reason of fifteen
   words at most: `yes` (the position held today or the thread of the
   career is this job, under any name), `close` (an adjacent profile the
   role profile lists, the job held earlier, the same function in a
   neighbouring domain), `no` (another job), `unknown` (no title, or only
   generic ones nothing on the card ties to a job). A shared word does
   not make the same job; the seniority, the years, the place and the
   detail of the must-haves are left to the full reading; between
   `close` and `no` it answers `close`. **Rules bind the answer** (`enforceTriage()`):
   a card left unanswered, or a verdict outside the four, is `unknown`; a
   reason that names a protected characteristic or a career break is
   withheld; and **the guard** turns a `no` into `close` when the card's
   current title or headline carries the job's title or one of its
   equivalent titles as whole words (`carriesRoleName()`, without what a
   job ad adds: "H/F", "CDI", "(e)"), so a lazy answer never drops a
   profile that names the job. The verdicts of a call are written in one
   statement (`record_triage()`); a call the model cannot answer is read
   again in halves down to the card that fails, which is settled
   `unknown`; a candidate archived since leaves the snapshot. Only `no`
   is set aside: the profile keeps its verdict and reason in
   `search_triage`, and the page counts it.
3. **Deterministic verdicts** in the server (`src/lib/briefs/matching.ts`,
   pure, tested): one verdict per criterion, `match`, `partial`, `missing`
   or `not_stated`, each with the evidence it rests on (the skill, the
   language and its level, the years, a snippet of the CV). `missing` is
   given only when the CV contradicts the requirement (a language absent
   from the listed ones, years below the threshold, a place that
   contradicts) and carries that evidence; a skill the CV does not name is
   `not_stated`; the role is only ever *found*, in a headline or an
   experience title that carries the words of its name, never `missing`.
   Points are `match` 1, `partial` 0.5, `missing` 0, weighted by the
   criterion's weight; the score is 0..100 over the criteria that could
   be evaluated, `coverage` their share, `blocked` true when a required
   one is missing. Ranking: not blocked first, then score, then coverage.
   On the text path `runSearch` scores the profiles read; for a
   whole-pool search **the promotion** (`promoteTriage`, rate scope
   `search`, no model call) scores the profiles the triage kept (`yes`,
   `close`, `unknown`) and brings them into the results with their
   verdict and reason, `yes` first, then `close`, then `unknown`, then
   the score; a profile already there is never added twice. The whole
   analysis is stored as a `searches` row (query, criteria at run time,
   results, method, pool size, who ran it, and the counts the lists read:
   `result_count`, `assessed_count`, `match_count`, `near_count`); the
   newest row of a brief is the one its page opens, its stages read off
   what is stored, and the earlier rows stay.
4. **The screening** (`assessCandidates`, members, rate scope `assess`),
   with a model and criteria only: does this CV answer this brief? Six
   candidates a batch (`ASSESS_BATCH_MAX`), three batches in flight
   (`READ_CONCURRENCY`: the write-backs merge entry by entry, so they
   add up), the rows updated as batches return. Each
   candidate is one JSON call (`assessmentSystemPrompt`,
   `LLM_ASSESSMENT_MODEL`, temperature 0) with
   the brief (the role first and apart, its definition the profile's; the
   profile compact: domain, level, years, missions, equivalent titles,
   adjacent profiles, context, must-haves, success factors; then the
   other requirements) and the profile, read as a senior recruitment
   consultant reads a CV before presenting the candidate, as a trajectory
   in the context of the job and not a list of keywords: the structured
   fields first, then the CV's text clipped so the payload stays under
   about 9 000 characters, the name, e-mail addresses and phone numbers
   removed from every text (`redactIdentity()`: the model reads a
   profile, not a person). The profile's must-haves are the team's words
   and are checked through the requirements only; the brief's text never
   adds a requirement (something it asks for that no requirement lists is
   at most a concern or a question). The model answers one row per
   requirement (`yes`, `partial`, `no`, `unknown`, with a quote of at most
   200 characters taken from the profile as it is written), judging the
   role before anything else from what the person *did* (missions, scope,
   clients, seniority of the positions) before how the positions were
   titled, on the most recent and longest positions: `yes` when the
   person held the role or an equivalent one under another title (a title
   with no description is read for what it usually means in its
   industry), `partial` for an adjacent role that shares part of the core
   missions, a role held only long ago or briefly, or a manager who led
   the job without carrying its missions, `no` when the career is another
   métier (a CV full of other missions is not silence: the `no` quotes
   them), `unknown` only when the profile holds no experience at all (for
   a junior brief, internships and first positions are positions); the
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

   **Rules then bind the answer** (`src/lib/briefs/assessment.ts`, pure,
   tested). Every criterion gets a row (a skipped one is `unknown`).
   **Every quote is checked against what the model was given**:
   `payloadTexts()` lists the texts of the payload (one per field, one per
   experience with its dates, the timeline of the positions as one), and
   `evidenceGrounded()` looks for the quote in them, case, accents and
   spacing apart: whole when short, else a window of twelve characters
   found verbatim, else 60 % of its tokens of four letters or more found
   as words of one text. A `yes` without a quote, or with one found
   nowhere, becomes `partial`, the quote kept and marked unverified
   ("quote not found in the CV" in the drawer); a `no` without a grounded
   quote becomes `unknown`, unless the deterministic pass found the
   requirement missing with evidence of its own, which is then shown; a
   `yes` on a required criterion the deterministic pass contradicts
   becomes `partial` with both readings; a dimension's score stands above
   neutral (50) only on a grounded quote. A note, an evidence, a strength,
   a concern, a question or a tiering line that names a protected
   characteristic or a career break (`forbiddenSentence()`: the core
   list, the wider words in a personal construction such as "sa famille"
   or "née en 1975", the phrases of a career break or a leave, the job's
   own collocations such as "politique commerciale" or "race condition"
   taken out first) is withheld and counted (`withheld`), and the drawer
   says the reading shown is incomplete by that much. The **composite
   score** (`src/lib/briefs/scoring.ts`) replaces the model's: role 0.40,
   seniority 0.15, context 0.15, the mean of trajectory and achievements
   0.15, and the weighted coverage of the other requirements 0.15 (`yes`
   1, `partial` 0.5, `no` 0, weighted 1..3 as the brief says, `unknown`
   left out, 50 when nothing is evaluable); a dimension the model did not
   score is neutral; the model's own score is kept apart as `modelScore`,
   advisory, and the drawer says what the composite is made of. **The
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
   raised. The assessment is merged into the same `searches.results`
   entry (with the model that answered) and carried to the brief's
   shortlist items that still hold an unassessed match. One failed
   candidate stays unread and "Reprendre" picks it up.
5. **The second opinion** (`challengeCandidates`, retained profiles only,
   six a batch, `CHALLENGE_BATCH_MAX`): one more call per `fit`, with the
   same brief, the same redacted profile and the first reading (decision,
   score, summary, the rows with their labels, the dimension scores and
   notes, the strengths, the concerns), asked for the strongest reason
   *not* to present this profile, in this order: a métier mismatch hidden
   behind titles, a seniority mismatch against the profile, a
   contradiction between facts of the CV, a must-have the first reading
   marked met that the profile does not meet, a context too far when the
   brief insists on it; silence is never a reason, nor is a reservation
   the first reading already lists. It answers `confirmed` (with one
   sentence on what the profile rests on) or `doubt` with a reason and a
   quote. `applyChallenge()` can only lower: a doubt whose quote is found
   in the profile and whose reason names nothing forbidden sends the
   decision to `borderline` (a `no_fit` is never raised), caps the score
   at 69, appends the reason to the concerns and stores the challenge; a
   doubt without a quote, or with one the profile does not hold, is an
   opinion and is stored as confirmed, changing nothing. The drawer puts
   the doubt first among the reservations ("Seconde lecture : …").
6. **The comparative tiers** (`rankCandidates`, `src/lib/briefs/ranking.ts`):
   the retained and borderline results, best score first, in groups of
   up to eight (`RANK_GROUP_MAX`; a last group of one takes one from the
   group before it, since one candidate cannot be compared, and fewer
   than two is nothing to compare; one profile alone left without a tier
   is compared again with the best already tiered). One call per group,
   with the brief in a few lines (title, role definition, must-haves) and
   one compact sheet per result, never the person: the decision, the
   score, the five dimension scores, the requirement rows with the
   required ones marked, the seniority note, the strengths, the concerns,
   the second opinion's reason. The model answers a tier per candidate,
   A (present now: the métier is the role, every must-have met, the
   second opinion raised nothing major), B (worth a deeper look: a real
   reservation to check; a required requirement at `unknown` or `partial`
   is B at most), C (not now: within this group the reservations outweigh
   what the profile brings next to the others), each with one line saying
   why relative to the others, and the tiers are not quotas: a group of
   similar profiles may all be A. `applyRanking()` binds it: a `no_fit`
   gets C at most, a `borderline` B at most, a `fit` at C becomes
   `borderline` (never `no_fit`: the team decides), an id the group does
   not hold is ignored, a line naming what no sentence may is withheld.
   When the tiering took several groups, one last call compares the A's
   of every group (eight at most, `finalRankGroup`), so the order of what
   is presented is one comparison and not several.

**While it runs**, the band opens with one live count (the profiles
kept so far, then the likely matches; "Préparation du vivier…" while the
search itself is prepared) and "Interrompre", then the bar of the
current step ("Tri du vivier", "Lecture approfondie", "Seconde
lecture", "Classement"; the promotion closes the first, the final
comparison belongs to the last) with "{step} · {done} / {total}" and the
time left once known; "Interrompre" stops at the next batch (pressed
while the search is prepared, the search is stored and nothing of it is
read), and leaving the page stops the loop. "Reprendre" comes back once
the calls a stopped loop had in flight have landed, so none is sent
twice. Each start or resume of a whole-pool search first takes in the
active profiles the pool gained since its snapshot; once it is done, the
band counts the ones gained since ("12 nouveaux profils", "Analyser"). A
match the second opinion has not seen yet reads "À confirmer" while the
analysis is not through. A batch that fails is sent once more at the end of its
stage; an error no retry fixes (rights, setup, the session) stops the
loop and says why; a call the rate limit refused waits 20, 40 then 65
seconds before it counts as failed. What came back is stored: every
write-back is one statement (`merge_search_results()`: the row locked,
each entry of the batch replacing the entry of the same candidate, the
others appended, the counts recomputed), so batches in flight together
add up and two people on the same entry is last-write-wins on that entry
alone. "Reprendre" reads the stored search and sends what each stage
lacks: the profiles of the snapshot without a verdict, the kept ones not
yet in the results, results without an assessment, retained ones without
a second opinion, retained or borderline ones without a tier; a
candidate gone from the pool since the search is settled and never sent
again. An analysis another tab or a colleague is driving (it moved in
the last ninety seconds) reads "En cours dans une autre session" and is
followed, not resumed a second time. The triage and the three stages use
`LLM_ASSESSMENT_MODEL` (see "Model"); a triage call is one `ai_usage`
row of kind `triage`, every other call one of kind `assess`.

**The brief page** (`/app/briefs/:briefId`) is one page and no left
module. A slim sticky header carries the title, the status when it is
not simply open, when it changed, the one filled button ("Lancer
l'analyse", then "Relancer"; "Analyse en cours…" while one runs; outline
while the band or the board carries the expected action) and a menu
(close or reopen the brief, delete it for administrators), with the
thread's button on a phone. Under it, the brief folded to three lines
("Voir le brief" / "Replier", shown only when three lines do not hold
it) with "Modifier", which opens the title, the text and the status in a
drawer: a text change marks the band "Brief modifié · relancez
l'analyse" until the next run (the row's hash says it for a colleague's
edit too, `briefChangedSince()`). Then two tabs kept in the URL
(`?tab=matches|shortlist`), "Correspondances" and "Shortlist", no count
in their names (the band's headline and the board's columns carry the
figures); the matches stay mounted behind the shortlist, so an analysis
under way keeps its rows. From `lg` the team's thread on the brief is
the right column (`ThreadPanel`, 360px, sticky), on a phone a drawer.
One analysis per brief is on screen, the newest: a newer one a colleague
starts takes its place, and the earlier rows stay in the database with
no menu to reopen them. The matches tab, top to bottom:

- the **band**, one sheet in the state the analysis is in. Idle, the
  headline counts the matches ("12 profils correspondent", "Aucun profil
  ne correspond"; "Aucune correspondance pour l'instant" while profiles
  are left) and one quiet line of figures says how the pool narrowed,
  "1 091 analysés · 84 retenus au tri · 61 lus en entier · 3 écartés"
  and the date (`figuresLine()`: the ones read in full only while some
  are left, the ones set aside only when there are any), the "écartés"
  figure being the button that opens their drawer, and a "Lecture du
  modèle" pill once a profile was read. Running: the live figure (the
  profiles kept, then the likely matches; "Préparation du vivier…" while
  the search is prepared) with "Interrompre", the step line ("Tri du
  vivier · 640 / 1 091") with the time left once known, and the bar.
  Unfinished: how many profiles are left and "Reprendre", or "En cours
  dans une autre session". Done with profiles gained since: "12 nouveaux
  profils" and "Analyser". No match once everything ran: the requirement
  most often missing. An analysis no model could read: "Texte seul, sans
  modèle" (or "sans exigences") and how many profiles it ranked; one
  stored before the whole pool was read: how many of the pool it read.
  An empty pool: the way to the import.
- the **matches alone** (`fit`), one 64px row each, tier then score: the
  rank, the photo or the initials, the name and the position held today,
  one line from `md` (the tiering's note, else the first sentence of the
  reading), the tier letter (`TierPill`: A an ink disc, B an ink
  outline, C a grey outline) or the quiet word "À confirmer" while the
  second opinion has not seen the match, and beside the row the
  shortlist button (a check once added). No ring: the score lives in the
  drawer. Rows rise in as their batch lands and never again.
- right under them, a quiet toggle, "N profils proches", unfolds the
  near profiles (`borderline`): muted rows with their main reservation
  (the second opinion's doubt, else the first concern). A profile set
  aside (`no_fit`, or `no` at the triage) is a figure of the band, never
  a row: the figure opens a drawer listing every one on demand, fifty at
  a time, with its reason (the triage's, else the must-have at `no`,
  else the main reservation), each leading to the profile, marked once
  as the model's reading; a member may have one the triage set aside
  read in full anyway ("Lire quand même": its `no` becomes `close`, it
  joins the results and the analysis resumes), since a person decides,
  not the model.
- the **drawer** of a row (`Sheet size="lg"`), which walks its list with
  two buttons and the arrow keys and stays on its person when a batch
  reorders the list: the photo or the initials, the name, the position,
  "12 ans · Casablanca" ("Non renseigné" when the CV states no years),
  the tier, the decision when it is not "Correspond", the score as a
  plain figure ("82 / 100"); "Ajouter à la shortlist" (or "Voir la
  shortlist") and "Voir la fiche"; then why this profile (the tiering's
  note first, then the reading's summary, marked as the model's, with
  the count of sentences the filter withheld), the requirements with
  their evidence (the role first, an unverified quote marked, what the
  CV does not state "Non renseigné"), the strengths and the reservations
  side by side (the second opinion's doubt first), the five dimensions
  as meters with the composite's make-up and the model's own score
  behind an info icon, the interview points, the triage's verdict and
  reason, small and muted, and the team's thread on the candidate (the
  same one as the candidate's page). The `why` sentences of analyses
  stored before evolution 2 (`ai_usage` kind `explain`) are still read
  where present; nothing writes them any more.

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
profiles are still to read it reads "Aucune correspondance pour
l'instant". The thresholds are the exported constants of
`src/lib/briefs/assessment.ts`, each tested at its boundary in
`assessment.test.ts`.

**What the shortlist and the dossier carry.** The whole reading
(`Assessment`: the rows, the dimensions, `strengths`, `concerns`,
`questions`, `tier`, `rankNote`, `challenge`, `modelScore`, `withheld`)
travels as JSON inside `searches.results` and `shortlist_items.match`,
no column change; every field is optional, so an assessment stored before
evolution 3 reads as before and the pages show nothing of what it lacks.
An item added to the shortlist holds the match of that moment: the
screening is carried to an item added before its batch returned (the
server fills an unassessed match only), the second opinion and the tier
are not carried afterwards. The board's card shows the tier letter beside
the name and the line the tiering wrote for this rank (else the main
reservation); the drawer's "Lecture" tab shows the recruiter's reading
(`src/lib/shortlists/requirements.ts`, `recruiterReadingOf()`): the
dimensions, the line among the retained, the strengths, the reservations
with the second opinion's doubt marked as the second reading, the
interview points, then the requirement rows; the score is a figure in
its header. The dossier (`src/lib/shares/draft.ts`) takes a sheet's
strengths from the reading's, its attention points from the concerns
with the doubt as one more point, and its **questions** (up to five,
`ShareItem.questions`) from the reading's, shown on the sheet under
"Points à vérifier en entretien" only when there are some; the sheets go
out as the shortlist stores them (the one-step dialog asks the model for
nothing); an assessment without a reading falls back on the requirement
table as before, and a share made before the questions existed has none.

**What an analysis costs.** The reading of the brief is one `brief` call
per brief (the text clipped to 12 000 characters in, 3 200 tokens out at
most, `LLM_MODEL`), made again only when the title or the text changed.
Then the triage is one call per forty profiles of the pool, about
16 000 characters in at most and a budget of 600 tokens plus 110 per
card out (5 000 for forty), on `LLM_ASSESSMENT_MODEL`; a
call the model cannot answer is read again in halves, sixteen calls at
most. Then, per profile the triage kept, one `assess` call of about
9 000 characters in and a budget of 1 800 to 3 200 tokens out, growing
with the number of criteria (the five dimensions, the three lists and one
row per criterion). A retained profile takes a second call (the same
input, 400 tokens out). Each group of up to eight retained or borderline
profiles takes one tiering call (a few thousand characters of sheets,
120 tokens out per candidate), and the A's of several groups one final
call. So a presented profile is three to four calls (its screening, its
second opinion, its group's tiering, the final comparison when there
were several groups), a borderline one its screening and a share of its
group's call, a set-aside one a single call, and a profile the triage set
aside a fortieth of a call: a pool of 1 000 profiles of which 150 are
kept is 25 triage calls and 150 screenings before the second opinions
and the tiering.

## Shortlists

One shortlist per brief (`shortlists.brief_id` is unique), a tab of the
brief's page (`/app/briefs/:briefId?tab=shortlist`, `ShortlistBoard`),
created on the first "add to shortlist" from a result or when a member
first opens the tab (`ensureShortlist()`; a viewer reads what exists). An
item carries the match as a snapshot (`shortlist_items.match`: the
verdicts, the assessment when the model answered, and the criteria of
that analysis, so the table is read against the right brief whatever the
brief becomes). An item added before its batch returned receives the
assessment when it does (members insert a match, never update one; the
server fills only an unassessed one). The old addresses still work:
`/app/shortlists` goes to the briefs, and `/app/shortlists/:id` reads the
shortlist's brief under RLS and goes to its Shortlist tab.

The board has three columns from `lg`, **à examiner**, **retenus**,
**écartés** (`shortlist_items.status`), each with its count in its
title, one column at a time on a phone behind a segmented control. A
card is a sheet: the photo or the initials, the name (it opens the
drawer), the tier letter, the position and the years, the tiering's line
(else the main reservation), and a footer with the thread's count (it
opens the drawer on the thread), the two decisions that apply as quiet
icon buttons (Retenir, Écarter, Réexaminer), the person assigned, and a
menu (assign, open the profile, remove behind a confirmation). The
drawer (`Sheet size="lg"`): the person (photo, position, years, the tier,
the score as a figure), who decided and when (else who added them), the
decisions, "Voir la fiche", then two tabs, "Lecture" (the model's
reading of the match) and "Discussion" (the item's thread). Above the
board, one filled "Partager" once someone is retained (the brief page's
header turns its run button outline on this tab); under it, the shares
made from the shortlist.

- **Decisions**: a member retains, dismisses or reviews again. The
  database stamps `decided_by` and `decided_at` from the session; the
  drawer says "Retenu par Ana · il y a 2 h" from those columns, never
  from the browser.
- **The thread**: one per shortlisted candidate
  (`comments.shortlist_item_id`), the team's dialogue with `@` mentions
  over the members (`comments.mentions`, member ids read from the final
  text), live; a message is deleted by its author or an administrator.
  The brief and the candidate have threads of their own ("The team
  thread").
- **Assignment**: `assigned_to` names who follows the candidate.
- **Decision trace**: every change is a row in `activities`, written by
  database triggers (`shortlist.added`, `shortlist.removed`,
  `shortlist.status`, `shortlist.assigned`, `comment.added`), read at
  `/app/activity`; the per-item history panel is gone.
- **Gone from the interface**: the votes and the shared note per item.
  The `votes` table and `shortlist_items.note` stay in the schema with
  their grants; nothing reads or writes them any more (the migration
  that drops them is not written).
- **Realtime**: `shortlist_items` and `comments` (with `votes`,
  `documents`, `activities`, `briefs`, `shortlists` and `searches`) are
  in the `supabase_realtime` publication with full replica identity; the
  board subscribes under RLS and debounces changes into one re-read.

Viewers read the board; members write; the buttons follow the role and
RLS checks again.

## The team thread

Almost every object carries the team's dialogue, one component for every
screen (`src/components/thread`, `src/lib/threads`): a brief (the right
column of its page from `lg`, a drawer on a phone), a candidate (the
same on their page, and at the bottom of a match's drawer: the same
thread), a shortlisted candidate (the drawer's "Discussion" tab). A
thread is the `comments` table with one of `brief_id`, `candidate_id` or
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
name), and the briefs list and the dashboard say who wrote last on each
brief and when (`threadSummaries`). The pure helpers are tested
(`src/lib/threads/thread.test.ts`).

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
  sent nowhere), so the panel under the board can copy them again; a
  link created elsewhere cannot be shown. `shares` is written by the
  server only: the browser has no insert or update grant.
- **Expiry and revocation**: `expires_at` is checked on every open and
  the page says when the link stops working; `revoked_at` ends a share at
  once (a revoked link says so even after its date). Opens are counted
  (`view_count`, `last_viewed_at`, best effort) and the shares of a
  shortlist are listed under the board of its brief's Shortlist tab with
  their date, who shared, how many addresses, their state, a copy button
  for a link this browser created and a revocation in the row's menu.
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
conventions, plus one the Worker alone reads (`LLM_ASSESSMENT_MODEL`):

- **Mistral** is the recommended vendor (European hosting):
  `LLM_BASE_URL=https://api.mistral.ai/v1`, `mistral-small-latest` and
  `mistral-embed` by default when the base URL is Mistral's.
- **OpenAI** works with `https://api.openai.com/v1`, `gpt-4o-mini` and
  `text-embedding-3-small` (shortened to 1024 dimensions by the API).
  Anthropic through a gateway, Groq, Together, OpenRouter and a local Ollama
  expose the same chat and embeddings calls.
- **The assessment may use a stronger model**: `LLM_ASSESSMENT_MODEL` names
  another chat model of the same endpoint for the triage and the three
  passes of an analysis only (`triageCandidates`, `assessCandidates`,
  `challengeCandidates`, `rankCandidates`; `completeJson({ model })`);
  unset, `LLM_MODEL` does them too. The assessment is where the
  product's worth sits (does this CV answer this brief?), so when budget
  allows set it to a stronger model such as
  `mistral-medium-latest` and keep `mistral-small-latest` for structuring
  and the one reading of a brief; `ai_usage.model` records which one
  answered.
- **Embeddings are 1024 wide** (`EMBEDDING_DIMENSIONS`, the width of every
  `vector(1024)` column). A model answering another width is refused with a
  sentence naming the variable to change; the processor probes the model
  once at start and shows the state on `GET /health` (`embedding`).
- **Every answer is JSON**, validated with a zod schema, one retry quoting
  the validation error, then an error, never a partial object.
- **Usage is recorded** in `ai_usage` per organisation and kind
  (`structure`, `embed`, `ocr`, `brief`, `triage`, `assess`, `summary`;
  `explain` for rows written before evolution 2) with the model and the
  tokens; administrators read it. An analysis costs one `triage` call per
  forty profiles of the pool and one `assess` call per profile it kept,
  then the second opinions and the tiering ("What an analysis costs").
- **Rate limits**: every server function that calls the model, sends an
  email, creates a share, pokes the processor, runs a search or assesses a
  batch is behind `enforceRateLimit(scope)` (scopes `model`, `email`,
  `share`, `processor`, `search`, `triage`, `assess`): 60 calls per minute
  per client and per scope (the address, an IPv6 by its /64, and the user
  id as a second bucket; `triage` and `assess` count by the user alone
  once it is known, so an office behind one address does not share them).
  An analysis spends three scopes: `search` (the search, the snapshot's
  extension and the promotion), `triage` (four calls in flight) and
  `assess` (three in flight; the second opinion and the tiering share it).
  A throttled call answers `RATE:limited`: the analysis waits 20, 40 then
  65 seconds before it counts the call as failed, and the end of its
  stage or "Reprendre" sends it again; elsewhere the page says to try
  again in a minute. People behind one office address share that
  address's bucket for the other scopes.
- **Without a key** `modelConfigured()` is false: nothing reads the brief
  (a brief never read has no requirements), an analysis lists the pool
  on the text alone and the band says "Texte seul, sans modèle" (no
  triage, no assessment), dossiers are written from the verdicts, the
  processor structures by heuristics and sets nothing aside. Nothing is
  made up.

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
  the triage card carries no name, contact detail, place, link or CV text,
  and the assessment payload no name, e-mail or phone.
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
- **Votes and notes**: the `votes` table and `shortlist_items.note` have
  had no interface since evolution 6; nothing writes them, and the
  migration that drops them is not written.
- **Photos**: nothing replaces or removes a candidate's photo short of
  erasing the candidate; a wrong one (a logo the rules took for a
  portrait) stays until then, and a candidate typed by hand or read
  before evolution 4 gets one from the next CV with a portrait. The
  `photos` bucket is not in the nightly backup.

## Contributing

Rules of the road live in `AGENTS.md`; how a feature is laid out and the
helpers every feature uses in `docs/CONVENTIONS.md`; how a screen looks
and moves in `docs/DESIGN.md`. One branch and one
pull request per evolution, never a push to `main`, CI green before a
merge, no new dependency without the owner.
