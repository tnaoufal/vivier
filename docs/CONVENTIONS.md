# Writing a feature in Vivier

Read `AGENTS.md` first. This page says how the code is laid out and the
helpers every feature uses, so features look alike.

## Layout

```
src/routes/            file-based routes (TanStack Start); see routes/README.md
src/routes/app/        signed-in pages, rendered inside the app shell with an organisation loaded
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
RLS checks it.

Errors from supabase-js are objects with `code` and `message`; show
`t("common.error")` (or a specific sentence for a known code) with
`toast.error()` from `@/lib/toast`, and log the error.

## Server functions

Anything that needs a secret (the model, Resend, the processor, a share
token) is a server function in `src/lib/<feature>/<feature>.functions.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/server/supabase.server";
import { enforceRateLimit } from "@/lib/server/rate-limit.server";

const input = z.object({ accessToken: z.string(), orgId: z.string().uuid(), briefId: z.string().uuid() });

export const extractCriteria = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    // ... db() for service-role reads/writes, completeJson() for the model, recordUsage()
    return { ... };
  });
```

The browser calls it with the token: `await extractCriteria({ data: { ...(await withToken()), orgId, briefId } })`
(`src/lib/server/call.ts`). A thrown `AppError` (`src/lib/server/errors.ts`)
reaches the browser as an error whose message is the code; show
`errorMessage(locale, error)` with `toast.error`. Never put a model or
email call in the browser. Server-only modules end in `.server.ts`
(the bundler keeps them out of the client).

Service-role access is `db()` (`src/lib/server/supabase.server.ts`): a
PostgREST client (`select(path)`, `insert`, `patch`, `delete`, `rpc`,
`signUrl`, `removeObjects`). Because it bypasses RLS, every handler calls
`requireMember()` first and filters by the organisation it verified.

The model: `completeJson({ system, user, schema })` and `embed(texts)`
(`src/lib/model/model.server.ts`), both throwing `SETUP:model` when no key
is set; check `modelConfigured()` first when a feature has a no-model
path (it always should: the search runs on text alone, a summary is left
for the person to write). Record every call with `recordUsage(orgId, kind, usage)`.

## Sentences

Every visible sentence is `t("feature.key")` from `useT()` / `useI18n()`.
Add your keys in `src/lib/i18n/features/<feature>.ts` following
`shell.ts` (`fr` object, `en` object with `satisfies Record<keyof typeof fr, string>`,
export `{ fr, en }` under the feature's name), then register the file in
`src/lib/i18n/features/index.ts` (one import, one entry in `files`).
Dates: `formatDate`, `formatDateTime`, `formatRelative` from `@/lib/i18n`.

## Components

shadcn/ui primitives in `src/components/ui` (button, card, dialog,
dropdown-menu, input, label, popover, select, separator, sheet, skeleton,
tabs, textarea, tooltip, command). App-shell pieces in
`src/components/app-shell`: `PageHeader`, `EmptyState`, `Pill` (tones:
neutral, positive, caution, negative, primary), `Avatar`, `ConfirmDialog`.
Utilities: `sheet` (a bordered card), `label-caps`, `font-display`,
`skeleton`, `surface-float`, `surface-dialog`. Icons from `lucide-react`.
Tailwind v4 tokens: `bg-background`, `text-ink`, `text-muted-foreground`,
`border-border`, `text-positive` / `text-caution` / `text-negative`
(verdicts), `bg-primary`.

Layout rules: a page starts with `PageHeader`; lists are `sheet`s with
rows; forms use `Label` + `Input`/`Textarea`; destructive actions go
through `ConfirmDialog`; every async button is disabled while busy; every
empty list shows an `EmptyState` with the action that fills it. Phone
width first: no fixed widths, wrap, `sm:` for two columns.

## Tests

Pure logic lives in its own module with a `*.test.ts` next to it
(vitest, node environment). Component tests opt into jsdom with
`// @vitest-environment jsdom` on the first line. No network, no
Supabase in tests: inject functions or fake clients.

## What a feature must not touch

`package.json` / `bun.lock` (no new dependency), `src/lib/db/types.ts` and
the migration (ask for a change instead), `src/components/app-shell/app-shell.tsx`
(the nav is fixed), another feature's directories.
