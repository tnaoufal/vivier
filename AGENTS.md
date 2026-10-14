## Vivier development rules

Vivier is the collaborative talent pool for HR teams: upload CVs, match
them to a brief, build a shortlist together, share it by email. It has its
own repository (`tnaoufal/vivier`), apart from Namearly; the two share a
stack and nothing else.

- GitHub is the source of truth. Never push directly to `main`: one branch
  and one pull request per evolution; CI (`.github/workflows/ci.yml`) must
  be green.
- The stack is the one of Namearly: TanStack Start on Cloudflare Workers,
  Supabase (Postgres, Auth, Storage, Realtime, pgvector), a Node service on
  Railway (`services/processor`), Resend, Paddle. Dependencies are locked:
  the frontend's `bun.lock` is frozen (`bun install --frozen-lockfile`);
  adding a package is an owner decision, not a session's.
- No decision is ever made by a machine. The model structures CVs,
  extracts criteria from a brief, ranks and assesses requirement by
  requirement (a reading, bound by rules in `src/lib/briefs/assessment.ts`);
  a person retains or dismisses, and `shortlist_items.decided_by` says who. The UI never hides
  this. A criterion the CV says nothing about is `not_stated`, never a
  mismatch; a field the model did not read is absent, never invented.
- No sensitive inference: age, date of birth, gender, origin, family,
  health, religion, union, politics are never extracted, stored or used
  as criteria. The photo read from a CV's first page is stored and shown
  for identification only (`candidates.photo_path`, the private `photos`
  bucket, off for an organisation with `organizations.show_photos`) and
  never reaches the model or any criterion. A career break, a gap or a
  period without a position is never read, scored or mentioned either
  (such sentences are withheld).
- Access is decided by `memberships.role` through RLS
  (`supabase/migrations`) and, in server functions, by `requireMember()`
  reading the access token the browser sends: never by anything else. The
  service role key, the processor secret, the model key and the Resend key
  live only in the Cloudflare dashboard (or Railway for the processor) and
  are never echoed by `/status`.
- Every server function that calls a model, sends an email, creates a
  share or pokes the processor runs behind `enforceRateLimit()`
  (`src/lib/platform/rate-limit.server.ts`, `VIVIER_RATE_LIMITER` binding).
- Emails are transactional only (invitations, shared shortlists), through
  Resend, each one a row in `email_sends`; nothing marketing, nothing to a
  candidate.
- GDPR: each organisation sets `retention_months` (24 at most); the
  processor purges expired candidates and their files (CVs and photo)
  every hour; a candidate can be exported and erased on demand from
  their page; every action is in `activities`.
- The interface speaks French and English (`src/lib/i18n`); every sentence
  shown is a dictionary key with both languages; `en` must carry every key
  of `fr` (tested).
- The pages never pretend: a document that failed says why in one
  sentence, a search without a model says it ran on text only, a share
  says when it expires.
- Every screen follows the design charter, v2 (`docs/DESIGN.md`): the
  tokens of `src/styles.css` (never a hard-coded colour, radius or
  duration), the primitives of `src/components/ui` and
  `src/components/app-shell`, one icon per control, motion that explains
  and stops under `prefers-reduced-motion`; a list row shows what tells
  rows apart, never every field.

## Validation

- Frontend: `bun install --frozen-lockfile`, `bun run build` (generates
  `src/routeTree.gen.ts`), `bun run typecheck`, `bun run test` (Bun 1.3.9,
  Node 22).
- Processor: `npm install` (then `npm ci` once `package-lock.json` is
  committed), `npm run typecheck`, `npm test`, `npm run build` from
  `services/processor`; `docker build -f services/processor/Dockerfile .`
  from the repository root, and `GET /health` must answer 200.
- `docs/GO-LIVE.md` is the owner's checklist (dashboards, secrets,
  providers): append what a session finds there instead of repeating it
  in chat.
