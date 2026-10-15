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
                   │          │ service role │ bearer secret (POST /process, POST /analyses/<id>)
                   ▼          ▼              ▼
            ┌───────────────────────┐   ┌──────────────────────────────┐
            │ Supabase (EU)         │◀──│ Processor (Railway, Node)    │──▶ model vendor, Mistral OCR
            │ Postgres 17 + RLS     │   │ services/processor           │
            │ Auth, Storage (`cvs`, │   │ polls documents, classifies, │
            │ `photos`), Realtime,  │   │ structures, dedups, photos,  │
            │ pgvector              │   │ embeds, re-embeds, purges,   │
            │                       │   │ runs the analyses as jobs    │
            └───────────────────────┘   └──────────────────────────────┘
```

| Component | Code                                   | Runs as                                                        | Holds                                                                                   |
| --------- | -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser   | `src/routes`, `src/components`         | the signed-in person, under RLS                                | the publishable key (public), the session's access token (memory)                       |
| Worker    | `src/lib/*/*.functions.ts`, `src/routes/api/*` | Cloudflare Workers; service role after `requireMember()` | every secret of the web side (see "Secrets")                                            |
| Database  | `supabase/migrations`                  | Postgres with policies, triggers and SECURITY DEFINER helpers  | everything: one `org_id` on every row                                                   |
| Processor | `services/processor/src`               | one Node process on Railway, service role                      | the service role key, the model key, the OCR key, the shared secret                     |
| Resend    | `src/lib/email/email.server.ts`        | called by the Worker only                                      | nothing of ours beyond the emails sent                                                  |
| Model     | `src/lib/model/model.server.ts`, `services/processor/src/model.ts` | called by the processor (the analysis, the structuring) and the Worker (a dossier draft) only | the text it is sent (CV text, briefs; for the triage and the screening a card per profile without name, contacts, place, link, summary or CV text; for the full reading and the second opinion a profile without name, e-mail or phone; for the tiering sheets of scores and sentences, without name or CV text) for the duration of the call; never the photo |

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
                                 photos/<org>/<cand>.png  ◀─────  photo (best effort, outside the lock, once per candidate
                                 candidates.photo_path            without one): a portrait among page 1's images (unpdf)
                                                                  or the OCR's cut-outs, 256 px PNG; never read by a model
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

The analysis is a job the processor runs; the browser never drives a
step. The Worker stores the row and pokes the processor, the processor
works stage by stage and writes the row, the browser follows the row.

```
Browser (member)           Worker                                        Supabase                      Processor (Railway)
────────────────           ────────────────────────────────────────      ────────────────────────      ────────────────────────────────────
runSearch({token, org,
  briefId})        ──────▶ requireMember(member), enforceRateLimit("search")
                           load brief (service role, org filter)      ─▶ briefs
                             no title and no text: INPUT:invalid
                           the brief's newest search:
                             queued or running: answered as it is (never doubled)
                             stopped or failed on the same reading of the
                               brief (role_profile.sourceHash unchanged, the
                               same criteria): patched queued, stop_requested
                               false, error null, started_at and finished_at
                               null (the claim stamps a fresh start: the pace
                               the band shows is this run's)             ─▶ searches   (it resumes where it was)
                             else: insert {method triage, status queued,
                               criteria, results [], pool_size 0, ran_by} ─▶ searches
                           POST /analyses/<id> (bearer, 8 s; best effort:                         ──▶ enqueue (202)
                             a failed poke is logged, the scan picks the row up)
                           return {searchId, createdAt, status}
the band follows the row: realtime on searches (brief_id) and a read every 10 s while queued or running;
closing the tab changes nothing
                                                                     claim (status running, runner,  ◀── at boot, every 30 s and on a poke:
                                                                       started_at, heartbeat_at)        queued rows, and running rows whose
                                                                                                        heartbeat is older than 120 s
                                                                     each step is idempotent: it reads what it lacks from the database and
                                                                     writes stage, progress_done / progress_total, heartbeat_at per batch;
                                                                     stop_requested is read between two batches (then status stopped):
                                                                     1. reading: needsDerivation(brief)? ONE call, temperature 0
                                                                        (readBriefPrompt, enforceBriefReading: the profile cleaned and
                                                                        guarded, the hash of the text kept)  ─▶ briefs.role_profile + criteria,
                                                                        the search's criteria snapshot, analysis_model      (ai_usage brief)
                                                                     2. snapshot: rpc start_triage(org, search)  ─▶ search_triage: one row per
                                                                        active candidate, verdict null; searches.pool_size
                                                                     3. triage, batches of 40 cards, 4 calls in flight: a card with no
                                                                        headline and no titled position is "unknown" without a call
                                                                        (isThinCard, "Fiche sans poste ni intitulé"); triageCard() per
                                                                        profile (no name, contact, place, link, photo, summary or CV text),
                                                                        triagePayload() under 16 000 characters, enforceTriage(),
                                                                        rpc record_triage                                   (ai_usage triage)
                                                                        a call that fails: the batch split in two, then in two again; a
                                                                        part of 10 or fewer failing twice: "unknown", "Fiche illisible par
                                                                        le modèle", attempts bumped (rpc bump_triage_attempts)
                                                                     4. screening, batches of 25 kept cards (yes, close; "unknown" is
                                                                        never kept), 4 in flight: a score 0..100 against the brief's
                                                                        reading (the level first, then the must-haves, then the context)
                                                                        and a reason of 12 words (screenPayload, enforceScreen); rpc
                                                                        record_screen (the first write wins; an unscorable card keeps
                                                                        score null); the same splitting                     (ai_usage screen)
                                                                     5. promotion: rankKept() (score desc, nulls last, yes before close);
                                                                        the 30 best (PROMOTE_MAX) and every forced row enter the results
                                                                        with scoreCandidate()'s verdicts, the triage and the screening on
                                                                        the entry; rpc merge_search_results
                                                                     6. assessing, one call per entry, 4 in flight: assessmentPayload()
                                                                        (name, e-mail, phone redacted), enforceAssessment(); merged per
                                                                        batch; carried to the shortlist items without one   (ai_usage assess)
                                                                     7. challenging: the retained ones, applyChallenge()
                                                                     8. ranking, then final: groups of 2..8, applyRanking(); the A's of
                                                                        several groups compared once
                                                                     9. done: status done, finished_at, progress at its total
                                                                     any error: status failed and a code in error (processor_error,
                                                                       model_unavailable, brief_missing, brief_empty, brief_unreadable,
                                                                       brief_changed: the brief's text changed since this run read
                                                                       profiles on its earlier reading), the stage kept; nothing retries
                                                                       by itself, a person runs it again; a profile whose full reading
                                                                       failed is skipped and counted: error assess_failed:<n> on a done row
                                                                     SIGTERM: the batches in flight finish, the row stays running, the
                                                                       next boot claims it as stale
the band (bandStateOf, presentation.ts): queued "Démarrage…" and "Interrompre" │ running: the stage's name,
  "640 / 1 093", the time left (etaOf: the pace since started_at over progressOf()'s span), the bar │
  stopped: "N profils restent à analyser" (stoppedLineOf: the profiles the stage had left, else the stage with
  its own count, "Classement · 2 / 4") and "Reprendre" (runSearch: the same row) │ failed: one line from the
  code (brief_changed, model_unavailable, else a generic one) and "Relancer" │ done: "12 profils
  correspondent", the figures (analysed, kept by the triage, read in full, set aside), the matches, the near
  profiles (borderline, then the screened rows with "score · reason"), the profiles set aside on demand
readSearch (RLS)   ─────────────────────────────────────────────────▶ searches.results: read when the status changes, and every 20 s
                                                                     while assessing, challenging or ranking (the matches land as read)
listScreened (RLS) ─────────────────────────────────────────────────▶ search_triage: yes/close with a score, not in the results,
                                                                     score desc, 50 a page
listSetAside (RLS) ─────────────────────────────────────────────────▶ search_triage: no and unknown with their reasons, keyset pages of 50
readTriageState (RLS, once the job ended) ──────────────────────────▶ search_triage: five counts, the band's figures
stopAnalysis({…, searchId}) ─▶ requireMember; a row still queued: status stopped at once (the patch holds
                               while it is queued, as the claim's does); a running one: stop_requested = true
                                                                      ─▶ searches (the runner stops at its next step)
readAnyway({…, searchId,
  candidateId})    ──────▶ requireMember, enforceRateLimit("search")
                           a row set aside or unread: verdict close,
                             forced true, no reason; a kept row: forced ─▶ search_triage
                           a run done or stopped: queued again + poke  ─▶ searches (the promotion takes every forced row)
"add to shortlist" ──────▶ (browser, RLS) shortlists (first use) + shortlist_items with the match snapshot
```

The funnel is bounded, so a run on 1 100 profiles ends in about four
to five minutes whatever the model does with one batch: the triage
reads every card once, the screening scores the kept ones, and only
the thirty best (and the ones a person forced in) are read in full.
Every step reads its remaining work from the database, so a stopped
or crashed run resumes where it was; a lost poke, a crash or a
redeploy never loses a run (the scan claims queued rows and stale
running rows); "Reprendre" queues the same row again. A row stored
before the job existed reads `done` (the column's default), so an
earlier analysis reads as it always did.

`search_candidates()` and `similar_candidates()` (the "similar profiles"
drawer of a profile page, which the browser calls directly) are SECURITY
INVOKER: even called with the service role, the Worker filters by the
organisation it verified, and the browser can call them only for the
organisations it belongs to. `start_triage()`, `record_triage()`,
`merge_search_results()` (migration `20261015090000`), `record_screen()`
and `bump_triage_attempts()` (migration `20261015150000`) are SECURITY
INVOKER too and executable by the service role alone; members read
`search_triage` and `searches` under RLS and write none of it (the
Worker's server functions patch `status`, `stop_requested` and the
forced rows through the service client). The snapshot is one
statement, so the pool size stored with the search and the rows to read
are the same set; an erased candidate or a deleted search takes its rows
with it. `merge_search_results()` locks the search's row, replaces each
entry of the same candidate where it stands, appends the others and
recounts `result_count`, `assessed_count`, `match_count` and
`near_count`: batches add up, and the lists read the counts without the
results.

The **role profile** (`briefs.role_profile`, `src/lib/briefs/role-profile.ts`
and the package's `role-profile.ts`) is the understanding of the job a
senior recruiter writes before reading a CV: domain, level and years,
core missions, equivalent titles, adjacent profiles, the context the
brief states, must-haves, nice-to-haves, success factors, interview
points, and what the brief does not state and the model assumed. The
processor writes it with the criteria, in the one reading of the brief
(`readBriefPrompt`, one call at temperature 0; `enforceBriefReading()`:
cleaned and guarded, a field naming a protected characteristic dropped,
a `yearsMax` the brief did not state dropped, the hash of the text it
was read from kept as `sourceHash`), and again only when the brief's
text changed (`needsDerivation()`). Nobody edits it: the consultant's
text is the only source, and no page shows the profile (the column's
`UPDATE` grant to members stands in the migration, unused). Every
payload reads it: the triage, the screening (the level, the years and
the context judged against it), the full reading, the tiering (its
must-haves). The **role requirement** is the first criterion of the
reading (`briefs.criteria`, `src/lib/briefs/criteria.ts`), exactly one:
the job as the model names it (else the brief's title) and its
definition, read off the profile (`roleDefinitionOf()`: domain,
missions, equivalent titles) so the criterion, the triage and the
payloads read one job; the model's own definition stands only when the
profile names nothing. The guard reads a role on the core list only,
since a job's domain is written with words ("famille de produits",
"politique commerciale") the wider list bans. The full reading judges
it before anything else, from what the person did before the titles,
and the rules bind the answer on the role first (`enforceAssessment()`:
`no` forces `no_fit` and caps the score at 25, `partial` caps at
`borderline` and 65, `unknown` at `borderline` and 60), then on the
required requirements (`no` forces `no_fit` and 39, `unknown` caps at
`borderline` and 69, `partial` at `borderline`); the score is the
composite of the package's `scoring.ts` (role 0.40, seniority 0.15,
context 0.15, the mean of trajectory and achievements 0.15, the
requirements' weighted coverage 0.15), the model's own score kept apart.
The second opinion (`applyChallenge()`) can only lower a retained
profile, on a quote found in the profile; the tiering (`applyRanking()`)
can only move a `fit` to `borderline`, never to `no_fit`. The
deterministic pass only finds the role in a title that carries the words
of its name, never calls it missing.

The **triage** (the package's `triage.ts`, pure, tested) is the brief a
senior recruiter gives a sourcer, on a card per profile: is this
person's job this job (`yes`), a neighbouring one worth reading
(`close`: an adjacent profile of the role profile, the job held earlier,
the same function in a neighbouring domain), another one (`no`), or can
the card not tell (`unknown`: no title, or only generic ones). It judges
the métier from the whole card, never from a title's wording alone, and
leaves the seniority, the years, the place and the detail of the
must-haves to the screening and the full reading; between `close` and
`no` it answers `close`. The job it reads is the role profile when the
brief has one (its title, domain, level, equivalent titles, adjacent
profiles, six missions and six must-haves), else the role criterion and
the brief's title (`triageRoleBrief()`). Only `yes` and `close` go on to
the **screening** (`screen.ts`): a card with nothing to judge, or one
the model could not read twice, is `unknown` and set aside with the
reason that says which (`THIN_CARD_REASON`, `UNREADABLE_REASON`), never
read in full by itself; the guard (`carriesRoleName()`, on the job's
title and its equivalent titles without what a job ad adds: "H/F",
"CDI", "(e)") keeps every card whose current title or headline names
the job. The screening gives each kept card a score against the brief's
reading and a reason of twelve words; the **promotion** reads the
thirty best (`promotable()`: every forced row, then `PROMOTE_MAX` by
score, yes before close), and the rest are the near profiles the page
lists under its toggle with their score and reason. A profile set aside
keeps its verdict and reason in `search_triage`; the page counts it in
the band's figures, and that figure opens on demand the list of every
profile set aside (`listSetAside()`, keyset pages under RLS: `no` with
the model's reason, `unknown` as "Non lus" when the model could not
read it) where, as on a screened row, a member may bring one back to be
read in full (`readAnyway()`: its row becomes `close` and `forced`, the
run is queued again when it had ended, and the promotion always takes
a forced row). A run reads the pool as it was when its snapshot was
taken; "Relancer" on a finished analysis starts a new one on the pool
as it is now. The detail of the prompts and the rules is in the README
("Briefs and search").

### Team thread: one dialogue per object

```
Browser (member)                              Supabase
──────────────────────                        ──────────────────────────────────────────────────
TeamThread({briefId} | {candidateId}
  | {shortlistItemId}), src/lib/threads
  listThread ──────────────────────────────▶ comments where <column> = id, the last 100, newest last
                                              (policy: members read); the authors' profiles in one lot
  postMessage ─────────────────────────────▶ insert {org_id, <column>, author_id = me, body ≤ 8000,
                                              mentions: the member ids read from the final text}
                                              (policy: member and author_id = auth.uid();
                                               check: at least one of the three columns, the page sets one)
                                              trigger: activities comment.added
  deleteMessage ───────────────────────────▶ (policy: the author, or an administrator)
Realtime (comments, <column>=eq.<id>) ◀───── change: the thread re-reads, debounced
Dashboard: listMyMentions ─────────────────▶ comments where mentions @> [me], newest first,
                                              the objects named (briefs, candidates, items in lots)
Briefs list, dashboard: threadSummaries ───▶ comments where brief_id in (…): count, last author, excerpt
```

Nothing of it crosses the Worker: the browser writes under RLS as the
author, the policies and the grants are those of evolution 1 (the three
target columns were there from the start), and a deleted candidate,
shortlist item or brief takes its messages with it (`ON DELETE
CASCADE`).

### Share: a dossier to a hiring manager

```
Browser (member)               Worker                                      Supabase / Resend
──────────────────             ─────────────────────────────────────       ───────────────────────────────
one dialog, one click ("Partager"): the candidates ticked (the retained ones first), the
addresses and a message (optional; off without an email sender), then in a row:
draftShare({token, org,
  shortlistId, candidateIds,
  useModel: false})     ──────▶ requireMember(member)
                               load shortlist + brief, the candidates, their latest CV
                                 and their shortlist match (org filter)
                               one sheet per candidate (draft.ts): facts, requirement table
                                 (assessment, else verdicts), score, decision, synthesis,
                                 strengths, attention and interview questions from the
                                 recruiter's reading (the second opinion's doubt among the
                                 attention points), else strengths / attention read off the table
                               (useModel true would rewrite the prose only, ai_usage: summary;
                                 the dialog never asks for it)
                               return { items, brief snapshot }
createShare({token, org,
  shortlistId, title: the brief's,
  intro: "", items, includeCvs: true,
  expiresInDays: 14})   ──────▶ requireMember(member), enforceRateLimit("share")
                               re-verify every candidate and CV id (org filter)
                               brief = briefSnapshot(the shortlist's brief)   never from the browser
                               token = random bytes (base64url)
                               insert shares { token_hash = sha256(token), items, brief, expires_at }
                               insert activities share.created
                               return { link: SITE_URL/share/<token> } ─ shown once; the raw token is never stored
                               (the browser keeps the link in sessionStorage, link-memory.ts, for the panel's copy button)
addresses given?       ──────▶ sendShare: requireMember, enforceRateLimit("email")
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

### Maintenance: stale reset, retention, re-embed, photos

```
Processor (hourly, 30 s after start, and POST /maintenance)   Supabase
───────────────────────────────────────────────────────────   ─────────────────────────────────────────────
stale reset: processing > 10 min → queued; after 3 claims → failed
expired_candidates(100)                  ────────▶ candidates past
                                                   coalesce(last_contact_at, created_at) + retention_months,
                                                   or consent_status = 'withdrawn'
for each:
  select documents.storage_path,         ────────▶
    candidates.photo_path
  remove the objects from `cvs` and      ────────▶ storage (missing objects are not an error)
    the photo from `photos`
  on failure: skip, leave for the next pass (a row never outlives its files)
  delete candidates row                  ────────▶ cascade: documents, shortlist_items, comments
                                                   trigger: activities candidate.deleted (name in payload)
re-embed (with a model):                 ◀──────── active candidates without a vector, newest first
  100 calls a pass, page by page past                (candidates_missing_embedding_idx)
  the profiles with nothing to embed,
  one ai_usage embed per call            ────────▶ candidates.embedding
  a wrong width stops the pass; /health says "mismatch"
photos (photo-backfill.ts), last:        ◀──────── candidates without a photo never checked
  50 a batch, up to 10 batches a run,                (photo_path and photo_checked_at null,
  two CVs read at once: page 1 of the                candidates_photo_pending_idx), with a
  newest CV with a text layer, the                   processed document
  pipeline's rules (a portrait among     ────────▶ photos/<org>/<cand>.png, candidates.photo_path
  page 1's images, 256 px PNG)
  every row listed is marked checked,    ────────▶ candidates.photo_checked_at (settled, photo or not;
  photo or not; no model call, no                    only a row the mark failed on is listed again)
  ai_usage row
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
the profile page): the CVs and the photo first (a photo path outside the
organisation's folder is never removed, since the service role bypasses
the bucket's policies), then the row, then one log line naming who erased
and how many files.

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
   `confidence` / `photo_path`, `organizations.plan` / `seat_limit` /
   `cv_quota_month` (`organizations.show_photos` is granted on its own and
   the `admins update` policy keeps it to administrators), cannot insert
   `shares`, `email_sends`, `activities`, `ai_usage`,
   `invitations` or `memberships`, and only moves a document back to
   `queued` (from `failed`, `needs_ocr` or `rejected`). `candidates.phone_digits`
   is computed by the database and written by nobody; `shares.brief` and
   the assessment in `searches.results` (the full reading, the second
   opinion, the tier) and the job's columns of `searches` are written
   by the processor alone (a member inserts a shortlist item's match,
   never updates one; the processor fills only an unassessed one; the
   Worker patches `status`, `stop_requested` and `error` for a person's
   "Lancer", "Interrompre" and "Lire quand même"); `briefs.role_profile`
   and `briefs.criteria` are the processor's one reading of the brief
   (guarded, `guardRoleProfile()`; the `UPDATE` grant members hold on
   `role_profile` is unused: no page writes it, members write the title,
   the text and the status); `search_triage` is read by members and
   written by the processor (and the Worker's `readAnyway`) alone. A
   `comments` row is a member's own message (`author_id = auth.uid()`)
   on a brief, a candidate or a shortlist item, deleted by its author or
   an administrator; the trigger logs `comment.added`. Triggers stamp
   `decided_by`, log activities and keep the last owner. Supabase's default privileges (every new table granted to `anon`
   and `authenticated`) are revoked at the top of the migration, so the
   grants written in it are the whole truth. `anon` has no grant on any
   table or function. Storage: a folder per organisation in each bucket;
   `cvs` is read by members, written by members, deleted by admins;
   `photos` is read by members, deleted by admins and written by the
   processor alone (no insert policy for the browser). Both are reached
   through signed URLs only (a CV five minutes, fifteen in the viewer; a
   photo ten minutes, cached in the browser, one hour in an export).
2. **The Worker's server functions.** They receive the access token in
   the call's data and nothing else about the caller. `requireMember()`
   verifies the token with Auth (cached five minutes, bounded by the JWT's
   expiry), reads the role from `memberships` with the service role and
   refuses below the minimum. Only then does the handler use `db()` (the
   service role, which bypasses RLS), and every query it runs names the
   organisation it verified. Costly handlers call `enforceRateLimit()`
   first (one scope each: `model`, `search`, `share`, `email`,
   `processor`; `triage` and `assess` stay declared, nothing uses them
   since the analysis left the Worker). The analysis's server functions
   store, stop and queue the row and poke the processor; no model call
   runs in the Worker for it. An `AppError` reaches the browser as a code (`AUTH:required`,
   `ORG:forbidden`, `RATE:limited`, `SETUP:model`…) that `errorMessage()`
   turns into a sentence; never free text from the server.
3. **The processor.** Server-to-server only: every route but `GET /health`
   needs the bearer secret (compared on SHA-256 digests in constant time),
   no CORS, every answer JSON, every error a sentence. It holds the service
   role key and works on rows the database hands it (`documents` queued,
   `searches` queued or stale, `expired_candidates()`, the candidates
   without a vector or a photo), naming the organisation of each row in
   every query. It writes the columns the browser may not, and
   serialises the candidate lookup and write per organisation in
   process (one instance on Railway; a second one would need a database
   key). What leaves for the model in an analysis is built by the pure,
   tested modules of `packages/analysis`: the triage and screening cards
   carry no name, contacts, place, link, photo, summary or CV text
   (`triageCard()`, `screenCard()`), the full-reading and second-opinion
   payloads no name, e-mail or phone (`redactIdentity()`), the tiering
   sheets no CV text at all, and every answer is bound by rules before
   it is stored (`enforceTriage()`, `enforceScreen()`,
   `enforceAssessment()`, `applyChallenge()`, `applyRanking()`), each
   quote checked against the texts the model was given
   (`payloadTexts()`); every call is one `ai_usage` row and the run's
   model is written on the row (`analysis_model`).
4. **The public share page.** The only unauthenticated reader of
   organisation data. It receives a token, never an id; hashes it; reads
   one `shares` row by `token_hash` with the service role; refuses expired
   and revoked shares; serves the snapshot in the row (the sheets and the
   brief's snapshot, not the live profiles or the live brief), mints
   short signed URLs for the CVs it lists and shows no photo. It is rate
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
| `SUPABASE_SERVICE_ROLE_KEY`                           | Every row of every organisation, storage signing, writing and removal in both buckets, the SECURITY DEFINER functions reserved to it (`expired_candidates`, `sync_plan_from_billing`) and the analysis's write functions (`start_triage`, `record_triage`, `record_screen`, `bump_triage_attempts`, `merge_search_results`) | Cloudflare dashboard (Worker), Railway (processor), `scripts/backup.sh` never (it uses the database URL) | the browser, git, `/status`, logs          |
| `PROCESSOR_SHARED_SECRET`                             | `POST /process`, `POST /analyses/<id>`, `POST /maintenance`, `GET /metrics` on the processor          | Cloudflare dashboard and Railway (the same value, 32+ characters)                           | git, the browser, health answers           |
| `LLM_API_KEY` (with `LLM_BASE_URL`, models, `LLM_ANALYSIS_MODEL` on the processor) | The model vendor: structuring and classification, embeddings, the one reading of a brief, the triage, the screening, the full readings, second opinions, tiers (on the processor; the Worker keeps it for dossier drafts, an option no screen asks for) | Cloudflare dashboard, Railway                                                     | git, the browser, `/status` (names only)   |
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
