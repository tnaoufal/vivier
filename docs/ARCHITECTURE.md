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
            │ Auth, Storage (`cvs`, │   │ polls documents, classifies, │
            │ `photos`), Realtime,  │   │ structures, dedups, photos,  │
            │ pgvector              │   │ embeds, re-embeds, purges    │
            └───────────────────────┘   └──────────────────────────────┘
```

| Component | Code                                   | Runs as                                                        | Holds                                                                                   |
| --------- | -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser   | `src/routes`, `src/components`         | the signed-in person, under RLS                                | the publishable key (public), the session's access token (memory)                       |
| Worker    | `src/lib/*/*.functions.ts`, `src/routes/api/*` | Cloudflare Workers; service role after `requireMember()` | every secret of the web side (see "Secrets")                                            |
| Database  | `supabase/migrations`                  | Postgres with policies, triggers and SECURITY DEFINER helpers  | everything: one `org_id` on every row                                                   |
| Processor | `services/processor/src`               | one Node process on Railway, service role                      | the service role key, the model key, the OCR key, the shared secret                     |
| Resend    | `src/lib/email/email.server.ts`        | called by the Worker only                                      | nothing of ours beyond the emails sent                                                  |
| Model     | `src/lib/model/model.server.ts`, `services/processor/src/model.ts` | called by the Worker and the processor only  | the text it is sent (CV text, briefs; for the triage a card per profile without name, contacts, place, link, summary or CV text; for the screening and the second opinion a profile without name, e-mail or phone; for the tiering sheets of scores and sentences, without name or CV text) for the duration of the call; never the photo |

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

```
Browser (member)             Worker                                   Supabase                 Model
────────────────             ──────────────────────────────────       ───────────────────      ─────────────
runSearch({token, org,
  briefId})          ──────▶ requireMember(member)
                             enforceRateLimit("search")
                             load brief (service role, org filter) ─▶ briefs (criteria, role_profile)
                             no role profile? write it (temperature 0,                    ──▶ JSON {assumptions, domain, seniority,
                               cleaned, guarded, yearsMax only when                           yearsMin/Max, missions, equivalent
                               the brief states one)                ─▶ briefs.role_profile     titles, adjacent profiles, context,
                                                                                               mustHaves, …} │ skipped
                             no criteria? derive them (a proposal;
                               the profile's must-haves required)                         ──▶ JSON {criteria} │ skipped
                               saved into the brief                 ─▶ briefs.criteria
                             no role? from the profile (no call) │ derive it              ──▶ JSON {label, value} │ the title
                               saved in front of the criteria        ─▶ briefs.criteria
                             a role and a profile? the role's definition
                               rewritten from the profile            ─▶ briefs.criteria
                             a model, criteria and a job to name? the whole pool:
                               insert searches row                  ─▶ method 'triage', results [], ran_by
                               rpc start_triage(org, search)        ─▶ search_triage: one row per active
                                                                       candidate, verdict null (one statement)
                               pool_size = the rows inserted        ─▶ searches.pool_size
                               (no snapshot: the row is deleted and the error answered)
                               the member's earlier triage searches
                                 of the brief nothing was read of   ─▶ deleted (best effort)
                             else, the text path:
                               count active candidates              ─▶ candidates (HEAD, count=exact)
                               ≤ 200: load the whole pool           ─▶ candidates (org filter, active)
                               > 200: queryTextOf(brief)                                  ──▶ embed (1024) │ none
                                 rpc search_candidates(org, terms,
                                   embedding | null, 120)           ─▶ full text (fts, simple, unaccent)
                                                                       ⊕ cosine over HNSW
                                                                       reciprocal rank fusion 1/(60+r)
                                 select the profiles returned       ─▶ candidates (org filter, active)
                               scoreCandidate() per profile:
                                 verdict per criterion + evidence
                                 (missing only with contradicting evidence;
                                  the role found, never missing)
                                 score over evaluable, coverage,
                                 blocked when a required one is missing
                               rankResults()
                               insert searches row                  ─▶ query, criteria, results, method, pool_size, ran_by
                             return {method, results, criteria, poolSize,
                               criteriaDerived, roleProfileDerived, needsCheck}
needsCheck (the model wrote the profile, the criteria or the role): the band says so and leads to
"Le poste"; nothing is sorted or read until "Lancer la recherche" (this search when the job is
unchanged, a new one on what the team saved)
then the stages (stages.ts), until done or interrupted; "Reprendre" sends what each one lacks:
0. the triage of a whole-pool search, forty profiles a call, four calls in flight:
pendingTriageIds() (RLS) ─────────────────────────────────────────▶ search_triage (verdict null, keyset pages)
triageCandidates({…,
  searchId,
  candidateIds[≤40]}) ─────▶ requireMember(member), enforceRateLimit("triage")
                             load brief, search (method 'triage')   ─▶ briefs, searches
                             the snapshot rows of these ids         ─▶ search_triage
                               read already: done, never sent twice;
                               outside the snapshot: failed
                             load the profiles (active; never the
                               contacts, links, photo, summary, text) ─▶ candidates
                               gone from the pool: out of the snapshot
                             triageCard() per profile: the headline, the
                               position held today, four earlier ones, the
                               years, the first degree without its year,
                               twelve skills; the name, e-mail, phone, place
                               and links taken out of every text; ref c1..cN
                             triagePayload(): the job (triageRoleBrief())
                               and the cards, shrunk a level at a time to
                               stay under 16 000 characters                               ──▶ JSON {verdicts: [{ref, verdict
                                                                                               yes│close│no│unknown, reason}]}
                                                                                               (LLM_ASSESSMENT_MODEL | LLM_MODEL)
                             enforceTriage(): one verdict per card (none,
                               or outside the four: unknown); a reason that
                               names a protected characteristic withheld; a
                               "no" on a card whose current title or headline
                               carries the job's name → close (guarded)
                             recordUsage("triage")                  ─▶ ai_usage
                             rpc record_triage(rows)                ─▶ search_triage (verdict, reason, model, read_at)
                             no valid answer: the halves, both in flight,
                               down to one card, settled unknown
                             return {done, failed, counts}
the failed batches sent once more at the end; the band counts the profiles kept so far
promoteTriage({…,
  searchId})         ──────▶ requireMember(member), enforceRateLimit("search")
                             the verdicts yes, close, unknown       ─▶ search_triage (keyset pages of 1 000)
                             those the results lack, lots of 100    ─▶ candidates (org filter, active)
                             scoreCandidate() + {verdict, reason};
                               gone from the pool: out of the snapshot
                             triageOrder(): yes, close, unknown, then score
                             rpc merge_search_results, 200 a call   ─▶ searches.results, result_count, the counts
                             return {results, promoted, poolSize}
1. the screening, six at a time, two calls in flight:
assessCandidates({token,
  org, briefId, searchId,
  candidateIds[≤6]})  ──────▶ requireMember(member)
                             enforceRateLimit("assess")
                             load brief, load search (org filter)   ─▶ briefs, searches
                             load the profiles (active)             ─▶ candidates
                             per candidate, in parallel:
                               assessmentPayload(): the role apart
                                 (its definition the profile's), the
                                 profile compact, the requirements,
                                 fields + CV text, name / e-mail /
                                 phone redacted                                           ──▶ JSON {requirements, dimensions ×5
                               enforceAssessment(): a row per                                 (score, note, evidence), strengths,
                                 criterion; every quote checked against                       concerns, questions, decision,
                                 payloadTexts() (not found: yes → partial,                    score, summary}
                                 no → unknown, a dimension ≤ 50);                             (LLM_ASSESSMENT_MODEL | LLM_MODEL)
                                 forbidden sentences withheld and counted;
                                 composite score (scoring.ts: role .40,
                                 seniority .15, context .15, track .15,
                                 requirements .15); the gates: role "no"
                                 → no_fit ≤ 25, "partial" ≤ 65, required
                                 "no" → no_fit ≤ 39, "unknown" ≤ 69, …
                               recordUsage("assess")                ─▶ ai_usage
                             rpc merge_search_results(these entries) ─▶ searches.results (assessment per entry), the counts
                             carry to unassessed shortlist items    ─▶ shortlist_items.match (+ criteria)
                             return {results, failed}
rows land as batches return: the matches listed, the near profiles behind their toggle, the rest counted
2. the second opinion on the retained ones, six at a time, two calls in flight:
challengeCandidates({…,
  candidateIds[≤6]})  ──────▶ requireMember(member), enforceRateLimit("assess")
                             load brief, search, the profiles ("fit" only)
                             per candidate: challengePayload() = the same
                               redacted profile + the first reading                       ──▶ JSON {verdict, reason, evidence}
                               applyChallenge(): a doubt quoted from the
                               profile → borderline, score ≤ 69, the reason
                               among the concerns; anything else: confirmed
                             rpc merge_search_results(these entries) ─▶ searches.results (challenge per entry)
3. the tiering of the retained and borderline ones, groups of 2..8, one at a time (then the A's of every group, once):
rankCandidates({…,
  candidateIds[2..8]}) ─────▶ requireMember(member), enforceRateLimit("assess")
                             load brief, search ("fit" or "borderline" only)
                             rankingSheets(): decision, score, the five
                               dimension scores, requirement rows, the
                               seniority note, strengths, concerns, the
                               doubt: no name, no CV text                                 ──▶ JSON {ranking: [{candidateId, tier, note}]}
                             applyRanking(): no_fit → C at most,
                               borderline → B at most, fit at C → borderline
                             rpc merge_search_results(these entries) ─▶ searches.results (tier, rankNote per entry)
rows reorder: tier, then score
"add to shortlist"   ──────▶ (browser, RLS) shortlists (first use) + shortlist_items with the match snapshot
```

`search_candidates()` and `similar_candidates()` (the "similar profiles"
drawer of a profile page, which the browser calls directly) are SECURITY
INVOKER: even called with the service role, the Worker filters by the
organisation it verified, and the browser can call them only for the
organisations it belongs to. `start_triage()`, `record_triage()` and
`merge_search_results()` (migration `20261015090000`) are SECURITY
INVOKER too and executable by the service role alone; members read
`search_triage` under RLS and write none of it. The snapshot is one
statement, so the pool size stored with the search and the rows to read
are the same set; an erased candidate or a deleted search takes its rows
with it, and a candidate archived since is taken out of the snapshot by
the next call that names it. `merge_search_results()` locks the
search's row, replaces each entry of the same candidate where it stands,
appends the others and recounts `result_count`, `assessed_count`,
`match_count` and `near_count`: batches sent in parallel add up, two
people on the same entry is last-write-wins on that entry alone, and the
lists read the counts without the results.

The **role profile** (`briefs.role_profile`, `src/lib/briefs/role-profile.ts`)
is the understanding of the job a senior recruiter writes before reading
a CV: domain, level and years, core missions, equivalent titles, adjacent
profiles, the context the brief states, must-haves, nice-to-haves,
success factors, interview points, and what the brief does not state and
the model assumed. The Worker writes it once at the first analysis (one
call at temperature 0, cleaned and guarded: a field naming a protected
characteristic is dropped, a `yearsMax` the brief did not state is
dropped) or on "Regenerate"; members edit it in the browser under RLS
(`GRANT UPDATE (role_profile)`), guarded the same way before the write.
Every payload reads it: the extraction makes its must-haves required
criteria, the screening judges the seniority and the context against it,
the tiering reads its must-haves. The **role requirement** is the
criterion of kind `role` a brief holds once (`briefs.criteria`,
`src/lib/briefs/criteria.ts`): the job as the team names it and its
definition, read off the profile whenever the brief has one
(`roleDefinitionOf()`: domain, missions, equivalent titles) and rewritten
from it before each search, so the criterion follows the team's edits;
a brief with a profile and no role gets it from the profile without a
call, one with neither from one small call (`roleDefinitionPrompt`) or
its title. The guard reads a role on the core list only, since a job's
domain is written with words ("famille de produits", "politique
commerciale") the wider list bans. The screening judges it before
anything else, from what the person did before the titles, and the rules
bind the answer on the role first (`enforceAssessment()`: `no` forces
`no_fit` and caps the score at 25, `partial` caps at `borderline` and 65,
`unknown` at `borderline` and 60), then on the required requirements
(`no` forces `no_fit` and 39, `unknown` caps at `borderline` and 69,
`partial` at `borderline`); the score is the composite of
`src/lib/briefs/scoring.ts` (role 0.40, seniority 0.15, context 0.15,
the mean of trajectory and achievements 0.15, the requirements' weighted
coverage 0.15), the model's own score kept apart. The second opinion
(`applyChallenge()`) can only lower a retained profile, on a quote found
in the profile; the tiering (`applyRanking()`) can only move a `fit` to
`borderline`, never to `no_fit`. The deterministic pass only finds the
role in a title that carries the words of its name, never calls it
missing.

The **triage** (`src/lib/briefs/triage.ts`, pure, tested) is the brief a
senior recruiter gives a sourcer, on a card per profile: is this
person's job this job (`yes`), a neighbouring one worth reading
(`close`: an adjacent profile of the role profile, the job held earlier,
the same function in a neighbouring domain), another one (`no`), or can
the card not tell (`unknown`: no title, or only generic ones). It judges
the métier from the whole card, never from a title's wording alone, and
leaves the seniority, the years, the place and the detail of the
must-haves to the full reading; between `close` and `no` it answers
`close`. The job it reads is the role profile when the brief has one
(its title, domain, level, equivalent titles, adjacent profiles, six
missions and six must-haves), else the role criterion and the brief's
title (`triageRoleBrief()`). Only `no` is set aside (`passesTriage()`):
a thin card is read in full rather than dropped, and the guard
(`carriesRoleName()`, on the job's title and its equivalent titles
without what a job ad adds: "H/F", "CDI", "(e)") keeps every card whose
current title or headline names the job. A profile set aside keeps its
verdict and reason in `search_triage`; the page counts it in the band's
figures, and that figure opens on demand the list of every profile set
aside (`listSetAside()`, keyset pages under RLS) with its reason, where
a member may bring one back to be read in full (`readAnyway()`: its
`no` becomes `close`, then it is promoted like a profile kept). Each
start or resume first extends the snapshot to the active profiles the
pool gained (`extendTriage()`, `start_triage` again), and a finished
analysis counts the ones gained since (`countOutsideSnapshot()`, an
anti-join). The triage refuses a batch once the role profile defines
the job otherwise than the search's role criterion (`INPUT:job_changed`:
a new search runs on the new job). The detail of the prompts and the
rules is in the README ("Briefs and search").

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
                                 strengths, attention and interview questions from the
                                 recruiter's reading (the second opinion's doubt among the
                                 attention points), else strengths / attention read off the table
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
   the assessment in `searches.results` (the screening, the second
   opinion, the tier) are written by the Worker alone (a member inserts a
   shortlist item's match, never updates one; the Worker fills only an
   unassessed one); `briefs.role_profile` is written by the Worker when an
   analysis derives it and by members when they edit it, guarded on both
   sides (`guardRoleProfile()`); `search_triage` is read by members and
   written by the Worker alone. Triggers stamp `decided_by`, log activities and keep the last
   owner. Supabase's default privileges (every new table granted to `anon`
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
   first (one scope each: `model`, `search`, `triage`, `assess`, `share`,
   `email`, `processor`). What leaves for the model is built by pure,
   tested modules: the triage cards carry no name, contacts, place,
   link, photo, summary or CV text (`triageCard()`), the screening and
   second-opinion payloads no name,
   e-mail or phone (`redactIdentity()`), the tiering sheets no CV text at
   all, and every answer is bound by rules before it is stored
   (`enforceTriage()`, `enforceAssessment()`, `applyChallenge()`,
   `applyRanking()`), each
   quote checked against the texts the model was given
   (`payloadTexts()`). An `AppError` reaches the browser as a code (`AUTH:required`,
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
| `SUPABASE_SERVICE_ROLE_KEY`                           | Every row of every organisation, storage signing, writing and removal in both buckets, the SECURITY DEFINER functions reserved to it (`expired_candidates`, `sync_plan_from_billing`) and the triage's write functions (`start_triage`, `record_triage`, `merge_search_results`) | Cloudflare dashboard (Worker), Railway (processor), `scripts/backup.sh` never (it uses the database URL) | the browser, git, `/status`, logs          |
| `PROCESSOR_SHARED_SECRET`                             | `POST /process`, `POST /maintenance`, `GET /metrics` on the processor                                | Cloudflare dashboard and Railway (the same value, 32+ characters)                           | git, the browser, health answers           |
| `LLM_API_KEY` (with `LLM_BASE_URL`, models, `LLM_ASSESSMENT_MODEL` on the Worker) | The model vendor: structuring and classification, embeddings, criteria, role profiles, the triage, screenings, second opinions, tiers, dossier drafts | Cloudflare dashboard, Railway                                                     | git, the browser, `/status` (names only)   |
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
