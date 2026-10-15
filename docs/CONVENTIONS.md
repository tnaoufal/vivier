# Writing a feature in Vivier

Read `AGENTS.md` first. This page says how the code is laid out and the
helpers every feature uses, so features look alike.

## Layout

```
src/routes/            file-based routes (TanStack Start); see routes/README.md
src/routes/app/        signed-in pages, each a `Workspace` inside the app shell, with a space loaded
src/lib/<feature>/     the feature's data access (`*.ts`), server functions (`*.functions.ts`),
                       server-only code (`*.server.ts`) and pure logic with tests (`*.test.ts`)
src/components/<feature>/  the feature's components
src/lib/i18n/features/<feature>.ts  the feature's sentences, fr and en
```

Routes: `src/routes/app/briefs/index.tsx` is `/app/briefs`,
`src/routes/app/briefs/$briefId.tsx` is `/app/briefs/:briefId`. A route
file exports `Route = createFileRoute("/app/briefs/$briefId")({ component })`
and nothing else of note. Dynamic params: `const { briefId } = Route.useParams()`.
Navigation: `<Link to="/app/briefs/$briefId" params={{ briefId }}>` and
`useNavigate()`. Do not edit `src/routeTree.gen.ts` (generated).

## The shared analysis package

The pure part of the analysis (the deterministic matching, the criteria
and the role profile, the prompts and the payloads, the assessment and
its rules, the triage, the screening, the funnel's rules, the run's
state machine) lives in `packages/analysis` (`@vivier/analysis`), used
by the web app through a path alias (straight from `packages/analysis/src`,
in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`) and by the
processor through a `file:` dependency (its `npm run build:analysis`
compiles the package into `packages/analysis/dist`, which is gitignored;
`build`, `test` and `typecheck` run it first, `npm run dev` needs it run
once, and the Dockerfile builds it in the image).
The package has zero dependencies: no zod, no React, no i18n, no `@/`
import, and no DOM or Node global (it carries no typings for them);
relative imports inside it end in `.js`. Each app keeps its own zod
schemas for the model's answers and for the stored JSON it reads
(`parseCriteria`, `parseRoleProfile`, `readBriefAnswer` stay in
`src/lib/briefs`, which re-exports the package so every web import keeps
its path). A pure function that used a parsed value takes the parsed
value. Tests sit next to the package's modules and run with the web
app's vitest.

## Reading and writing data from the browser

supabase-js under RLS, through `loadSupabase()` / `requireSupabase()`
(`src/lib/auth/supabase-client.ts`). The current organisation and role
come from `useOrg()` (`src/lib/org/org-context.ts`): `org.id` filters every
query, `can("member")` gates every write button. Row shapes are in
`src/lib/db/types.ts`; cast query results at the boundary:

```ts
const { data, error } = await supabase
  .from("briefs")
  .select("*")
  .eq("org_id", org.id)
  .order("updated_at", { ascending: false });
if (error) throw error;
const briefs = (data ?? []) as BriefRow[];
```

Reads in components go through `useQuery(key, read)` (`src/lib/data/use-query.ts`);
live updates through `subscribeToTable(table, filter, onChange)` with
`debounce(refresh)` (`src/lib/data/realtime.ts`). Inserts set `created_by`
/ `added_by` / `author_id` / `uploaded_by` to `user.id` from `useAuth()`;
RLS checks it. An RPC the browser calls (`similar_candidates`) is SECURITY
INVOKER, so RLS decides what it answers; its rows are guarded at the
boundary like any query result (`src/lib/candidates/similar.ts`). A loop
the browser drives (an import) sends bounded batches (`LOT_SIZE`),
renders progress, and can be stopped and resumed from what is stored. An
analysis is not one: the processor runs it as a job
(`services/processor/src/analysis`), the page follows its row
(`useAnalysis`, realtime on `searches`), and the browser never calls a
model for it. The team's thread on an object is `TeamThread` in a
`ThreadPane` (`src/components/thread`) on a `ThreadTarget`
(`{ briefId } | { candidateId } | { shortlistItemId }`); its reads and
writes live in `src/lib/threads`, never in a page.

Errors from supabase-js are objects with `code` and `message`; show
`t("common.error")` (or a specific sentence for a known code) with
`toast.error()` from `@/lib/toast`, and log the error.

## Server functions

Anything that needs a secret (the model, Resend, the processor, a share
token) is a server function in `src/lib/<feature>/<feature>.functions.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/platform/supabase.server";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";

const input = z.object({ accessToken: z.string(), orgId: z.string().uuid(), briefId: z.string().uuid() });

export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    // ... db() for service-role reads/writes, completeJson() for the model, recordUsage()
    return { ... };
  });
```

The browser calls it with the token: `await runSearch({ data: { ...(await withToken()), orgId, briefId } })`
(`src/lib/platform/call.ts`). A thrown `AppError` (`src/lib/platform/errors.ts`)
reaches the browser as an error whose message is the code; show
`errorMessage(locale, error)` with `toast.error`. Never put a model or
email call in the browser. Server-only modules end in `.server.ts`
(the bundler keeps them out of the client).

Service-role access is `db()` (`src/lib/platform/supabase.server.ts`): a
PostgREST client (`select(path)`, `count(path)` (a HEAD with
`count=exact`), `insert`, `patch`, `delete`, `rpc`, `signUrl`,
`removeObjects`). Because it bypasses RLS, every handler calls
`requireMember()` first and filters by the organisation it verified. A
list of ids in a query string stays at 100 or fewer (`planLots()`): the
gateway refuses a URL past 16 KB.

The model: `completeJson({ system, user, schema, model? })` and
`embed(texts)` (`src/lib/model/model.server.ts`), both throwing
`SETUP:model` when no key is set; `model` names another chat model of the
same endpoint for one call (no Worker call sets it since evolution 7: the
analysis's calls run on the processor, on `LLM_ANALYSIS_MODEL`). Check
`modelConfigured()` first when a feature has a no-model path (it always
should: the analysis runs on text alone, a dossier is written from the
verdicts). Record every call with `recordUsage(orgId, kind, usage)`,
`kind` one of `structure`, `embed`, `ocr`, `brief`, `triage`, `screen`,
`assess`, `summary`, a failed one too: a call
that fails after billed attempts throws `ModelAnswerError`, whose
`usage` (`usageOf(error)`) is recorded before the error goes on. A
payload that carries a candidate's text goes through `redactIdentity()`
(`src/lib/briefs/prompts.ts`) first: the model reads a profile, never a
name, an e-mail or a phone number; and an answer that a page will show
is bound by pure rules before it is stored (`enforceAssessment()` is the
pattern). Rate-limit scopes are `model`, `email`, `share`, `processor`,
`search`, `triage` and `assess` (the last two count per user alone once
the user is known; nothing uses them since the analysis left the Worker).

## Sentences

Every visible sentence is `t("feature.key")` from `useT()` / `useI18n()`.
Add your keys in `src/lib/i18n/features/<feature>.ts` following
`shell.ts` (`fr` object, `en` object with `satisfies Record<keyof typeof fr, string>`,
export `{ fr, en }` under the feature's name), then register the file in
`src/lib/i18n/features/index.ts` (one import, one entry in `files`).
Dates: `formatDate`, `formatDateTime`, `formatRelative` from `@/lib/i18n`.

## Components

shadcn/ui primitives in `src/components/ui` (button, dialog,
dropdown-menu, input, label, popover, select, separator, sheet, skeleton,
sonner, tabs, textarea, tooltip). App-shell pieces in
`src/components/app-shell`: the plane's `Workspace`, `Pane`, `PaneTitle`
and `PHONE_ICON` (`workspace.tsx`), `Row`, `RowText` and `useListKeys`
(`row.tsx`), the `Rail`; then `Section`, `EmptyState` (`quiet` inside a
pane), `InfoTip`, `Pill` (tones: neutral, positive, caution, negative,
primary; `dot` for a leading mark), `FilterChip`, `LocaleChips`,
`ProgressBar`, `Meter`, `Timeline`, `RequirementList`, `Avatar`,
`ConfirmDialog`, and `PageHeader` for the pages outside the plane. The
thread's pane, its toggle and its flag are `ThreadPane`, `ThreadToggle`
and `useThreadPane` (`src/components/thread/thread-pane.tsx`). A verdict
or a decision is always a pill or a mark with an icon and a text
alternative, never colour alone (`docs/DESIGN.md`). Utilities: `sheet`
(a bordered card, outside the plane only), `sheet-row`, `label-caps`,
`stat-number`, `font-display`, `skeleton`, `surface-float`,
`surface-dialog`; `share-sheet` for the public dossier only. Icons from
`lucide-react`.
Tailwind v4 tokens: `bg-background`, `text-ink`, `text-muted-foreground`,
`border-border`, `text-positive` / `text-caution` / `text-negative` (the
three monochrome tones, the ink, grey 700 and grey 500: never alone,
always with an icon or a word), `bg-primary`.

Layout rules. Every signed-in page is a `Workspace` and its panes
(`docs/DESIGN.md`, "Layout"): the header carries the title, the page's
figures in `meta`, the one filled button, the `ThreadToggle` when the
page has a thread, and an `Ellipsis` menu for the rest; under it, one
to three `Pane`s (a `list` or `wide` list, the `fill` detail) and the
`ThreadPane`. From `lg` the page never scrolls as a whole: each pane
scrolls inside itself. Never a `PageHeader` and never a `sheet` on a
signed-in page or in a block of its panes: panes and rows are divided by
lines (`src/lib/design/classes.test.ts` checks the pages and the thread
and activity blocks).

A list is an `ol` of `Row`s: `as="button"` when the row selects a detail
beside it, `as="link"` with a path from a helper when it leads to a
page, `RowText` for the name and its one line, the row's own buttons in
`trailing` (beside the control, never inside), `useListKeys` on the
`ol`. The selected row lives in the URL (`?c=`) and carries
`aria-current`; from `lg` the first row is selected when the URL names
none, below `lg` a tap opens the detail in a full `Sheet` or on its
page.

The thread pane: one per page, on the object the page shows (the
brief, the selected candidate, the selected shortlisted candidate):
`useThreadPane()` gives the flag, the header's `ThreadToggle` flips it,
`ThreadPane` renders the 320px pane from `lg` and a `Sheet` below; a
page that switches the thread's object passes a `Segmented` as its
children. Never a thread at the bottom of a page.

Forms use `Label` + `Input`/`Textarea`; destructive actions go through
`ConfirmDialog`; every async button is disabled while busy; every empty
list shows an `EmptyState` with the action that fills it (`quiet` inside
a pane). Phone width first: no fixed widths but the panes' from `lg`,
wrap, a header action shrinks to its icon below `sm` (`PHONE_ICON`).

## Tests

Pure logic lives in its own module with a `*.test.ts` next to it
(vitest, node environment). Component tests opt into jsdom with
`// @vitest-environment jsdom` on the first line. No network, no
Supabase in tests: inject functions or fake clients.

## What a feature must not touch

`package.json` / `bun.lock` (no new dependency), `src/lib/db/types.ts` and
the migration (ask for a change instead), `src/components/app-shell/app-shell.tsx`,
`rail.tsx` and `workspace.tsx` (the frame and the rail's four sections
are fixed), another feature's directories.

## Why `src/lib/platform` and not `src/lib/server`

The Vite config denies every import from a directory named `server/` in the
client bundle (TanStack Start's import protection). Server functions
(`*.functions.ts`) and the small client helpers (`call.ts`, `errors.ts`)
must stay importable from pages, so the server-side library lives in
`src/lib/platform/`; the modules that hold secrets end in `.server.ts` and
are only ever imported by server-function handlers and API routes.
