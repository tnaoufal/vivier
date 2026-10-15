# Vivier design charter, v4: Blackweaver monochrome, one plane

Vivier is a professional tool HR teams use for hours: a talent pool, a
brief, a shortlist built together, a dossier sent to a manager. The look
is the one of every Blackweaver project: black and white. One ink on
paper, greys for surfaces and secondary text, no accent colour anywhere,
a strong typographic hierarchy, generous whitespace, motion with a
purpose. Every block on a screen earns its place by helping a recruiter
decide; what does not, goes. This page is the contract every screen
follows. The tokens live in `src/styles.css`, the primitives in
`src/components/ui` (shadcn, restyled) and `src/components/app-shell`,
and two tests hold them (see "The proof").

What v4 (evolution 7 part B) changed for a person using the product.
The sidebar became a 64px rail of four icons, with the theme switch and
the person's menu (the spaces, a new team, the settings, the language,
the sign-out). Every signed-in page fits the screen as one plane: a
header over panes side by side, each scrolling inside itself, so a
list, the profile chosen in it and the team's thread are seen together
and the page never scrolls as a whole. The thread is the right pane, no
longer at the bottom of the page. Lists are rows divided by lines, with
the photo or the initials on every row; no card sits in the plane. The
greys are stronger, so the lines and the secondary text read, and the
dark theme is one click away on the rail. A person who works alone has
a personal space instead of a team of one.

## The rule

1. **One ink on paper.** Text, the one main action, the active mark, the
   arc of a ring and the fill of a bar are the ink (#0A0A0A) on paper
   (#FFFFFF). Surfaces, borders, tracks and secondary text are greys
   from one scale. Nothing else.
2. **No accent colour.** No green, no red, no amber, no blue: not for an
   action, not for a verdict, not for an error, not for a chart. The
   tones keep their names for the call sites (`positive`, `caution`,
   `negative`) and are the ink, grey 700 and grey 500.
3. **A state is never a colour.** A verdict, a status, a decision is told
   by a shape (filled, outlined, grey), a weight, an icon or a dot, and
   a word. Taken to greyscale, a screen loses nothing: it already is.
4. **Photos in greyscale.** A candidate's photo identifies a person and
   nothing more: the `photo` utility (`grayscale(1) contrast(1.05)`) is
   applied by the Avatar to every photo, and the photo never reaches a
   model.
5. **The dark theme is the mirror.** Paper on ink: the same scale read
   from the other end (`.dark`), the same shapes, the same words, one
   click away on the rail. A component never knows which theme it is in.
6. **One plane.** A signed-in page is a `Workspace`: from `lg` it fits
   the viewport, a header over panes side by side, each scrolling inside
   itself. Panes and rows are divided by lines, never by cards, and the
   team's thread is a pane beside the work.

## Principles

1. **One object.** Every page is built from the same skeleton (the
   header, the panes, the rows, the blocks under their label) and the
   same primitives, so the product feels like one thing, not twelve
   screens.
2. **Hierarchy before decoration.** Size, weight and spacing carry the
   structure; the ink and the greys carry the rest. No grey boxes in
   white boxes, no borders where a gap does the job, no fill where an
   outline says it.
3. **Earn the pixels.** A block exists only if it answers a recruiter's
   question ("does this profile fit?", "who decided?", "what is
   missing?"). A list shows what tells profiles apart, not everything the
   row holds.
4. **Honest by construction.** What the CV does not say reads
   "Non renseigné", never a dash or a zero. A model's sentence is
   introduced as the model's. A decision names who took it and when.
5. **Motion explains.** Things move to show where they came from, where
   they went, or that work is running. Nothing bounces, nothing loops
   for decoration, and a person who asked for less motion gets none.
6. **Phone first, desk best.** Every layout works at 360px with 16px
   gutters and no horizontal scroll; from `lg` the panes stand side by
   side and the plane fills the viewport.

## Tokens (`src/styles.css`)

Every colour token exists in light and in dark (`.dark` mirrors
`:root`; the durations and the layers live in `:root` alone); a
component never hard-codes a colour, a shadow, a duration or a radius. A
hex value appears in `src/styles.css` and in no component (the root
route's theme-color meta, the emails' inline styles and the bare error
page aside: they cannot read the tokens).

### The scale

v4, the scale of the one-plane workspace: stronger than v3 (a reader sees
the lines and the greys), every text AA at least and every edge above
its floor, proven by `src/lib/design/contrast.test.ts` on the real file.

| Grey      | Light     | Dark      | Used for                                                                                       |
| --------- | --------- | --------- | ---------------------------------------------------------------------------------------------- |
| paper     | `#FFFFFF` | `#0A0A0A` | the page, the panes, dialogs, menus; the text on an ink fill                                   |
| 50        | `#F7F7F7` | `#0F0F0F` | `thread`: the thread pane's background (dark: `card`, `popover` too)                           |
| 100       | `#F5F5F5` | `#141414` | `hover`: a row under the pointer                                                               |
| 150       | `#EFEFEF` | `#1C1C1C` | `muted`, `secondary`, `accent`: the selected row, the segmented track, a chip, a disc          |
| 200       | `#DEDEDE` | `#2A2A2A` | `line`, `border`, `track`: pane edges, row dividers, the header's edge, under a bar's ink      |
| 300       | `#C8C8C8` | `#3A3A3A` | `input`: field borders; the disc behind initials when there is no photo                        |
| 400       | `#C8C8C8` | `#5A5A5A` | `neutral`: the quiet outline of a dismissed mark, tier C                                       |
| 500       | `#5F5F5F` | `#A8A8A8` | `muted-foreground`, `negative`: meta lines, labels (6.4:1 on paper, 5.6:1 on the selected row) |
| 700       | `#333333` | `#D4D4D4` | `ink-soft`, `caution`: a second-rank text that stays dark                                      |
| ink (900) | `#0A0A0A` | `#F5F5F5` | text, `primary`, `ring`, `positive`, `destructive`, the active rail mark, the filled action    |

### Colour

| Token                                           | Light                             | Dark                              | Role                                                               |
| ----------------------------------------------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `background`                                    | `#FFFFFF`                         | `#0A0A0A`                         | the page, the panes                                                |
| `foreground`, `ink`                             | `#0A0A0A`                         | `#F5F5F5`                         | text, the filled action, the active rail mark                      |
| `ink-soft`                                      | `#333333`                         | `#D4D4D4`                         | a second-rank text that stays dark                                 |
| `muted-foreground`                              | `#5F5F5F`                         | `#A8A8A8`                         | meta lines, labels (AA on the page, on `muted`, `hover`, `thread`) |
| `line`, `border`                                | `#DEDEDE`                         | `#2A2A2A`                         | pane edges, row dividers, the header's edge                        |
| `track`                                         | `#DEDEDE`                         | `#2A2A2A`                         | under the ink of a bar or a ring                                   |
| `input`                                         | `#C8C8C8`                         | `#3A3A3A`                         | field borders                                                      |
| `neutral`                                       | `#C8C8C8`                         | `#5A5A5A`                         | the quiet outline of a dismissed mark, tier C                      |
| `muted`, `secondary`, `accent`                  | `#EFEFEF`                         | `#1C1C1C`                         | the selected row, the segmented track, a chip, a disc              |
| `hover`                                         | `#F5F5F5`                         | `#141414`                         | a row under the pointer                                            |
| `card`, `popover`                               | `#FFFFFF`                         | `#0F0F0F`                         | dialogs, drawers, menus (with a `border`)                          |
| `thread`                                        | `#F7F7F7`                         | `#0F0F0F`                         | the thread pane's background                                       |
| `primary` / `primary-foreground`                | `#0A0A0A` / `#FFFFFF`             | `#F5F5F5` / `#0A0A0A`             | the one filled action                                              |
| `ring`                                          | `#0A0A0A`                         | `#F5F5F5`                         | the focus ring                                                     |
| `destructive` / `destructive-foreground`        | the ink / paper                   | paper / the ink                   | erase: the confirm dialog and the word carry the consequence       |
| `positive` / `positive-foreground`              | `#0A0A0A` / `#FFFFFF`             | `#F5F5F5` / `#0A0A0A`             | met, retained, tier A                                              |
| `caution` / `caution-foreground`                | `#333333` / `#0A0A0A`             | `#D4D4D4` / `#F5F5F5`             | partial, to check: an outline tone (see below)                     |
| `negative` / `negative-foreground`              | `#5F5F5F` / `#FFFFFF`             | `#A8A8A8` / `#0A0A0A`             | missing, dismissed                                                 |
| `inverse` / `-foreground` / `-muted-foreground` | `#0A0A0A` / `#FFFFFF` / `#A8A8A8` | `#F5F5F5` / `#0A0A0A` / `#5F5F5F` | a toast, a tooltip                                                 |
| `scrim`                                         | the ink at 40 percent             | black at 70 percent               | under a dialog or a drawer (a veil darkens in both themes)         |

The `sidebar-*` tokens left with the sidebar: the rail draws itself with
`background`, `line`, `muted` and the ink. The `sheet` utility keeps its
1px border and has no shadow any more.

A tint is the token at an alpha (`bg-ink/10`: one step darker under the
pointer, on a secondary button), so dark mode follows on its own; a tint
is for the pointer, never under text alone, and inside the plane a row
under the pointer takes `hover` instead. `::selection` is the ink at 14
percent.

### The three tones

| Tone       | As a pill or a mark                                               | As text on the card                                              | As a fill                                             |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `positive` | the ink filled, paper text and mark                               | the ink                                                          | `bg-positive text-positive-foreground`                |
| `caution`  | a 1px ink outline, ink text and mark                              | `text-caution-foreground` (the ink) or `text-caution` (grey 700) | never at full strength: `bg-caution/10` with ink text |
| `negative` | a 1px grey 400 outline (`border-neutral`), grey 500 text and mark | grey 500 (`text-negative`)                                       | `bg-negative text-negative-foreground`                |
| `neutral`  | a grey 150 fill, grey 500 text                                    | grey 500                                                         | the not stated: never a judgement                     |

A tone never travels alone: a pill carries an icon or a dot (implied for
a verdict tone), a mark is an icon with a text alternative, a sentence
says the word. The old accent tone `primary` of the Pill is kept for
the call sites and draws like `caution`.

### Elevation, radii, layers

| Scale   | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shadows | `shadow-hairline` 0 1px 0 black at 6 percent (kept; no component uses it since the sheet lost it), `shadow-raised` 0 2px 8px at 8 percent (the lift of a card that leads somewhere; unused since the plane), `shadow-float` 0 8px 24px at 10 percent (menus, popovers, toasts, the thread pane laid over the detail), `shadow-dialog` 0 16px 48px at 12 percent (dialogs, drawers); every floating surface also has a 1px border, and no button has a shadow; dark deepens the alphas |
| Radii   | `rounded-sm` 6 (menu items, tooltips, small discs), `rounded-md` 8 (menus and popovers, the brand square), `rounded-lg` 12 (sheets, textareas, toasts), `rounded-xl` 16 (dialogs, drawers), `rounded-full` (buttons, pills, fields); nothing rounder than 16 but the pill                                                                                                                                                                                                             |
| Layers  | `z-sticky` 20 (the Workspace header below `lg`, the thread pane laid over the detail between `lg` and `xl`), `z-overlay` 40 (the scrim), `z-modal` 50 (dialog, drawer), `z-popover` 60 (menus above a drawer), `z-toast` 70                                                                                                                                                                                                                                                           |

### Type

Geist for everything, Poppins 600 (`font-display`) for display titles
only. Sentence case everywhere; no all-caps. Numbers in `tabular-nums`.

| Utility     | Size / line | Use                                                           |
| ----------- | ----------- | ------------------------------------------------------------- |
| `text-xs`   | 12 / 16     | pills, shortcuts                                              |
| `text-meta` | 13 / 20     | labels, meta lines, dates, hints (`label-caps`)               |
| `text-sm`   | 14 / 20     | secondary text, rows' second line, buttons                    |
| `text-body` | 15 / 24     | body, a dialog's consequence line                             |
| `text-base` | 16 / 24     | the Workspace title (600)                                     |
| `text-lg`   | 18 / 28     | compact empty-state titles                                    |
| `text-xl`   | 20 / 28     | dialog titles; the name heading a reading or a sheet (20/26)  |
| `text-2xl`  | 24 / 32     | page titles outside the plane, on phones                      |
| `text-3xl`  | 30 / 36     | page titles outside the plane (`font-display`), `stat-number` |
| `text-4xl`  | 36 / 40     | the landing page's hero on a phone                            |
| `text-5xl`  | 48 / 1      | reserved                                                      |
| `text-6xl`  | 60 / 1      | the hero from `sm`, the 404 number                            |

No sentence under a page title: the title and its key figure (in `meta`)
say enough (see "Content rules").

### Spacing

An 8px grid. Inside the plane there is no page padding: a pane's body
that holds blocks has 16px of padding, 24px from `sm` (`p-4 sm:p-6`),
its blocks 24px apart (`gap-6`) under their `label-caps` title; a pane
header's line is 48px (`PaneTitle`); a row is 56, 60 or 64px high with
a 12px gutter (`px-3`), 8px of vertical padding and 12px between its
parts (`gap-3`). The settings keep 32px between their sections
(`space-y-8`) in a column of 48rem at most; outside the plane a card has
24px inside (`p-6`). 8px between a label and its field. Touch targets
are 40px high; icon buttons 40 × 40; the 32px `sm` button lives only
inside a row or a pane's line that already measures 40px or more.

### Motion

| Token             | Value                       | For                                                     |
| ----------------- | --------------------------- | ------------------------------------------------------- |
| `duration-fast`   | 120 ms                      | hover, press, a colour change                           |
| `duration-base`   | 180 ms                      | menus, popovers, a segmented thumb, a reading fading in |
| `duration-slow`   | 240 ms                      | dialogs and drawers entering                            |
| `duration-slower` | 320 ms                      | rows rising in, a bar reaching its value                |
| `ease-out-soft`   | cubic-bezier(.2,.7,.2,1)    | everything that settles                                 |
| `ease-spring`     | cubic-bezier(.34,1.3,.64,1) | a dialog entering (a gentle overshoot, 4 percent)       |
| `--stagger`       | 40 ms                       | the wait between two rows of a list                     |

`src/lib/motion.ts` carries the same numbers for code that drives a
timer (`DURATION`, `staggerDelay`, `staggerVars`) and the reading of the
reduced-motion preference (`prefersReducedMotion`, `subscribeReducedMotion`,
shaped for a `useSyncExternalStore` hook; no component follows it live
today: the reduced-motion block of `styles.css` stills the tokens).

## Layout

- **The plane.** Every signed-in page is a `Workspace`
  (`src/components/app-shell/workspace.tsx`) inside the shell
  (`app-shell.tsx`). From `lg` (64rem) the shell is a grid of the 64px
  rail and the content column, as tall as the viewport; the Workspace is
  a 56px header (the eyebrow as a quiet link, then the title and the
  meta; on the right the one filled action, the `ThreadToggle`, an
  `Ellipsis` menu) over panes side by side, each scrolling inside itself
  (`min-h-0 overflow-y-auto`). The rail and the header are fixed by
  construction (no sticky) and the viewport never scrolls.
- **The rail** (`rail.tsx`): the brand square (32px of ink, the paper
  "V", the way to /app); four 44px icon links with a `Tooltip` on the
  right, the dashboard, the briefs, the pool and the team ("Espace" in a
  personal space), the current one filled with the ink, its icon in
  paper, `aria-current="page"`. At the bottom the theme switch (named
  for what it switches to) and the person's disc, whose menu holds the
  spaces (a check on the current one, the personal space first, a team
  with the person's role in it), "Nouvelle équipe", Réglages, the
  language and the sign-out. Switching spaces lands on the same section
  of the new space (its briefs, its pool, its team), or on its dashboard
  from any other page: a brief or a profile of the space left behind
  would read as missing there.
- **The panes** (`Pane`): a labelled region each, 440px for a list
  (`list`), 520px for a wider one (`wide`), the rest for the detail
  (`fill`); a 1px `line` between two panes; an optional header and
  footer kept in place around the body that scrolls. A list is an `ol`
  of `Row`s (56, 60 or 64px, the photo or the initials, `RowText`)
  divided by 1px `line`s; the selected row is `bg-muted` with
  `aria-current="true"`, the row under the pointer `bg-hover`; a row
  that matters less (`muted`: dismissed) fades its photo or its initials
  and sets its name in grey 500, never a word faded by alpha;
  ArrowUp/ArrowDown move the selection (`useListKeys`). The URL keeps
  the selected row (`?c=`): a refresh or a shared link lands on it, and
  from `lg` the first row is selected when the URL names none. The
  detail pane shows the selected row (a profile's reading, a candidate's
  sheet), its blocks 24px apart under a `label-caps` title (`Section`,
  `PaneTitle`); with nothing selected, one quiet line ("Aucun profil").
  No `sheet` in the plane (a card survives in dialogs, drawers, the
  sign-in and the public pages), no `max-w-6xl` centring, no page
  padding, no page transition (the detail fades its content in).
- **The thread pane** (`ThreadPane`,
  `src/components/thread/thread-pane.tsx`): the team's thread on what the
  page shows (the brief, the selected candidate, the selected
  shortlisted candidate), 320px on its own grey (`thread`) with a line
  on its left: a 48px header (the title, the count), the messages, the
  composer at the bottom. From `xl` (80rem) it stands beside the detail
  and is open by default; between `lg` and `xl` it is closed by default
  and, opened, lies over the detail's right side with the float shadow,
  so the detail keeps its width. The header's `ThreadToggle` flips it;
  the choice is remembered on the device (`localStorage`,
  `vivier-thread`) and another tab follows it. A new target mounts a new
  thread: another object's messages or draft never show under the new
  title.
- **Below `lg`.** No rail. A sticky 56px top bar: the menu button that
  opens the rail's items with their words in a `Sheet side="left"`
  (closed on every page change), the brand from `sm`, the title, the
  actions (40px icons below `sm`: `PHONE_ICON`, the label kept in a
  `max-sm:sr-only` span); the meta is hidden below `sm`. The panes stack
  full width and scroll with the page; a profile of a brief opens in a
  `Sheet size="full"` with the way back, a profile of the pool on its
  own page; the thread in a `Sheet` from the right, opened by the same
  toggle and not remembered. No horizontal scroll at 360px.
- Nothing narrower than its content: every flex child that may hold a
  long string gets `min-w-0` and the string `truncate` (file names,
  emails, URLs); a table scrolls horizontally inside its pane, never the
  page.

## Components

The primitives of `src/components/ui` keep their props from v2, in
monochrome. v4 adds the plane's (`Workspace`, `Pane`, `Row`, the rail,
the thread pane) and retires `PageTransition`, `ThreadPanel` and the
sticky `PageHeader`.

### `src/components/ui`

- **Button** `variant` primary (= default: the ink filled, paper text) ·
  secondary (grey 150, one step darker under the pointer) · outline
  (1px ink) · ghost · destructive (the same ink fill, with its icon: the
  `ConfirmDialog` is the safety, the word says the consequence) · link
  (the ink, underlined); `size` sm 32 · md 40 (= default) · lg 44 · icon ·
  icon-sm; `icon` the one leading 16px icon (a literal `<svg>` child is
  dropped and the svg of a child component is hidden, so a button can
  never show two; children that are not icons stay); `asChild`. No
  shadow. Focus: a 2px ink ring 2px off the control. Press feedback on
  every variant (`press`: 2 percent under the finger). At most one filled
  primary per view.
- **Input, Textarea, Select** 40px pill-shaped fields on the card colour
  (the textarea with 12px corners), a 1px grey 300 border, the
  placeholder grey 500; on focus the edge becomes 2px of ink. The Select
  trigger draws its one chevron; a caller never adds another; the chosen
  item carries an ink check.
- **Dialog** paper on the ink scrim, a 1px border, the dialog shadow,
  16px corners; `size` sm 28rem · md 32rem · lg 42rem · xl 56rem, 32px of
  padding, `overflow-hidden`; slots `DialogHeader`, `DialogBody` (the
  part that scrolls), `DialogFooter` (buttons wrap, stacked on a phone).
  Springs in over 240ms, leaves in 180ms. The close button is a 40px
  target and the content's last child.
- **Sheet** (drawer) the same surface; `side`, `size` md 32rem · lg 44rem
  · full (the viewport minus a gutter, for the CV viewer); slots
  `SheetHeader`, `SheetBody` (give the content `flex flex-col gap-6
overflow-hidden` to pin the header and footer), `SheetFooter`.
- **Tabs** a 40px grey 150 track with pill triggers, the active one a
  paper thumb with a 1px grey 200 edge and ink text; **Segmented** the
  same track without panels, `value`/`onChange`/`options` (label, one
  icon, a count in muted text at full strength, lighter by weight), a
  thumb that slides, arrow keys; `size` sm (36px) in a pane's header.
- **Tooltip** the inverse surface (the ink, paper text; paper on ink in
  dark), 13px, one line; the provider is mounted at the root. A tooltip
  never replaces an `aria-label`.
- **DropdownMenu, Popover** the float surface (paper, a 1px border);
  items 36px with one leading icon at most; `destructive` on an
  item for erase reads at medium weight with its icon in the ink. Menus
  open above drawers (`z-popover`).
- **Skeleton, SkeletonRows** grey 150 placeholders with a shimmer of the
  ink at 5 percent, the size of what they stand for (`avatarSize` sm · md
  · lg matches the Avatar the rows will show); `SkeletonRows` is the list
  every page shows before its rows arrive, at a row's height with
  `ROW_SKELETON`.
- **Toaster** the inverse surface (the ink, paper text, so it reads at
  once over any page), the icon alone at 16px (a check, or an alert for
  an error: the icon and the words tell them apart), bottom right, above
  everything.

### `src/components/app-shell`

- **Workspace** (`workspace.tsx`) `title`, `eyebrow` (the way back, a
  quiet link before the title: "Briefs / Directeur commercial"), `meta`
  (the page's figures after the title: a count with `role="status"` when
  a search changes it, a date, a pill, a filter; hidden below `sm`),
  `actions` (on the right: the one filled button, the `ThreadToggle`, an
  `Ellipsis` menu), children (the panes): the 56px header with a line
  under it, over the panes. From `lg` the frame is as tall as the
  viewport and the header static; below `lg` the header is sticky and
  opens with the menu button (`RailItems` in a `Sheet side="left"`,
  closed on every page change). `PHONE_ICON` is what a header action
  adds to become a 40px icon below `sm` (its label kept in a
  `max-sm:sr-only` span and an `aria-label`).
- **Pane** `label` (the region's name), `width` list 27.5rem · wide
  32.5rem · fill (the rest, the default), `header` and `footer` (kept in
  place, a line between them and the body), `bodyClassName`: a labelled
  `section` with a line on its right, but the last; from `lg` its body
  scrolls inside it, below `lg` it is full width with a line under it.
  **PaneTitle** `title`, `count`, `action`, `as`: the 48px `label-caps`
  line of a pane's header.
- **Row** (`row.tsx`) `as` button (it selects) · link (`to`, a path from
  a helper) · div (static), `selected` (`bg-muted`,
  `aria-current="true"`), `muted` (a dismissed row: the photo or the
  initials faded, the name in grey 500, the line and the controls at
  full strength), `height` sm 56 · md 60 · lg 64, `leading` (the rank,
  the Avatar), children (`RowText`, then a value such as a date),
  `trailing` (the row's own buttons, beside the control, never inside
  it), `id`, `aria-label`: the `li` of every list, a 1px line between two
  rows, `hover:bg-hover` when it leads somewhere, an inset ink ring on
  focus. **RowText** `title`, `line`: the name (14/18, 600) and one line
  of facts (13/18, grey 500), each truncated. **useListKeys**(count,
  index, onIndex): ArrowUp, ArrowDown, Home and End on the `ol`
  (`tabIndex={0}`); a field or a menu inside a row keeps its keys
  (`list-keys.ts`, pure, tested). **ROW_SKELETON** draws `SkeletonRows`
  at a row's height.
- **Rail** (`rail.tsx`) the 64px column of "Layout"; **RailItems** the
  same content as rows with their words, for the phone's menu;
  **BrandSquare** the brand alone (32px of ink, the paper initial, the
  way to /app); **ThemeToggle** `rail` is the rail's 44px switch.
- **PageHeader** outside the plane only (the legal pages, the status
  page, a form of the public frame): `eyebrow`, `title` (30/36, 24/32 on
  phones), `description` (one sentence), `meta`, `actions`, 32px of air
  below. A signed-in page has the `Workspace` header instead, and the
  slim sticky variant is gone.
- **Section** `title`, `count`, `action`, `id`: a block of a pane or a
  page, a `label-caps` title (its count, an action on the right) over
  its content.
- **InfoTip** `label` (the topic, added to the button's name "More
  information · …"), children (the sentence): the
  16px info icon in a 40px target that opens a small popover on click,
  tap or keyboard. The one place an explanation lives, beside the title
  or the label it is about; never a paragraph under it.
- **Pill** `tone` neutral (grey 150 fill) · positive (the ink filled,
  paper text) · caution (a 1px ink outline) · negative (a 1px grey 400
  outline, grey 500 text) · primary (kept for the call sites, draws like
  caution); `dot` or `icon` (14px), never both: `icon` wins, and a
  verdict tone without an icon draws the dot on its own (`dot={false}`
  withholds it, for a letter that is its own mark); `size` sm 20 · md 24.
- **Avatar** `name`, `size` sm 28 · md 36 · lg 44 · xl 72: a grey 300
  disc (`input`, the photo's placeholder, so it stays a disc on the
  selected row) with the initials in the ink; `photoUrl` (a signed URL;
  the photo is shown in greyscale through `photo`; the initials stay under it
  until it loads, then it fades in; a failed photo leaves the initials),
  `variant` disc · profile (square-rounded, for a candidate sheet),
  `decorative` (beside the visible name: hidden from assistive
  technologies, so the name is not read twice). The photo identifies a
  person in the interface only and never reaches a model.
- **ProgressBar** `value` (null = indeterminate), `max`, `size` sm 4px ·
  md 6px, `active` (a grey sheen), `tone` (accepted, changes nothing: the
  fill is the ink on a grey 200 track), `label` (required, for assistive
  technologies). The width eases over 320ms.
- **Meter** `label`, `value` (null reads "Non renseigné" and the bar is
  decoration: no meter role without a value), `max`, `hint`, `tone`
  (accepted, changes nothing), `name` (the accessible name when `label`
  is a node). An ink bar on a grey 200 track, for the five dimensions of
  an assessment.
- **Timeline, TimelineItem** `when`, `title`, `subtitle`, `current`,
  children: a vertical rail with ink dots (outlined; the current one
  filled), dates on the left from `sm`, items rising in one after the
  other. No page uses it today: the candidate sheet draws its own rail
  of positions, since a 7rem date column does not fit a detail pane.
- **RequirementList, RequirementMark** one row per requirement: the mark
  (✓ met: an ink disc with a paper check; – partial: an ink outline; ✗
  missing: a grey outline; ? not stated: a grey 150 disc; each with a
  text alternative), the label, the evidence; `compact` for print,
  `stagger` for rows that rise in once on screen.
- **EmptyState** `icon` (in a grey 150 disc), `title` (a few words),
  `text` (optional, at most one short line; usually not passed),
  `action` (one), `compact` inside a card or a drawer (the title a
  paragraph: the card's own title is the heading), `inset`
  inside a sheet (no card of its own, never a card in a card), `quiet`
  inside a pane (no sheet, no disc: the icon, the title, the action).
- **FilterChip** `active`, `onClick`, `icon`, `count`, `expanded` and
  `controls` (a chip that shows a panel says open or closed, not
  pressed); 40px like the field and the tabs beside it, a 1px grey 300
  border at rest, the ink filled with paper text when on; the count at
  full strength, lighter by weight only. **LocaleChips** the two
  languages, one on, each name in its own language (`lang`).
- **ConfirmDialog** a small dialog, cancel then the one confirming
  button (the ink, `destructive` or not: the question and its sentence
  are the safety), `busy` disables both.

### Elsewhere

- **ThreadPane** (`thread/thread-pane`) `target` (`{ briefId }`,
  `{ candidateId }` or `{ shortlistItemId }`), `title` ("Discussion" when
  omitted), `canPost`, `members`, `currentUserId`, `open`,
  `onOpenChange`, children (above the thread: a `Segmented` that
  switches the target): the thread pane of "Layout", `TeamThread pane`
  inside; below `lg` a `Sheet side="right"` on the same flag; a new
  target mounts a new thread. **useThreadPane**() gives `open`, `toggle`
  and `setOpen`: from `lg` the device's choice (`localStorage`,
  `vivier-thread`, "open" or "closed"; another tab follows), else open
  from `xl` and closed below; below `lg` the sheet's own flag, not
  remembered. It is read through `useSyncExternalStore`, so the server
  and the first render agree on closed.
- **ThreadToggle** `open`, `onToggle`, `count` (else read for `target`):
  an outline button, `MessageSquare` and the count beside it (hidden
  below `sm`), named "Discussion · 3 messages"; `aria-pressed` from
  `lg`, a dialog opener below (`aria-haspopup`, `aria-expanded`).
- **TeamThread** (`thread/team-thread`) `target`, `canPost`, `members`,
  `currentUserId`, `title`; `pane` (the 48px header with a line under
  it, the list and the composer each with the pane's 16px gutter),
  `compact` (a capped height, in a drawer), `hideHeader` (when a sheet's
  title is the thread's).
- **Switch** (`team/switch`)
  a 36 × 20 track in a 40px target: on, the ink with a paper thumb; off,
  grey 300 with an ink thumb (both AA, the thumb's side tells the state);
  the `switch` role.
- **TierPill** (`briefs/tier-pill`) `tier` A · B · C, `compact`: a
  monogram, the letter alone in a disc (A the ink filled, B an ink
  outline, C a grey outline), the readable name for screen readers and on
  hover.
- **DecisionPill** (`briefs/decision-pill`) `decision`: fit = the ink
  filled + `CircleCheck`, borderline = an ink outline + `CircleAlert`,
  no_fit = a grey outline + `CircleX`, unassessed = grey 150 +
  `CircleDashed`; `DECISION_LOOK` is the one map every decision reads.
- **BriefStatusPill** (`briefs/brief-status-pill`) `status`, `size`:
  open = an ink outline with a dot, closed = a grey outline, draft = a
  grey fill.
- **BrandMark, BrandIcon** the sprout in its circle and the wordmark,
  the ink on paper (paper on ink in dark); `gradient` is kept and draws
  the same ink.

### Utilities (`src/styles.css`)

`sheet` (a card: a 1px border, the card colour, 12px corners, no
shadow; outside the plane only), `sheet-row` (a roomy row, a line
between rows, a tint on hover when it leads somewhere), `label-caps`,
`stat-number`, `font-display`, `skeleton`, `surface-float`,
`surface-dialog`, `brand-text` (the ink), `photo` (a candidate's photo in
greyscale); motion: `press`, `rise-in`, `fade-in`, `stagger`, `shine` (a
grey sheen), `animate-indeterminate` (a bar whose size is unknown),
`duration-*`; layers: `z-*`; `share-sheet` for the public dossier only
(paper and ink on any theme). `sheet-link`, `lift` and `page-enter` are
still in the file, and no page uses them since the plane. Hiding a
control in print is Tailwind's `print:hidden`.

## Motion: what moves and why

| Moment                                       | Motion                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A page change                                | nothing moves: the rail and the header stay, the panes take the new page                                          |
| A profile chosen in a list                   | its reading fades in, 180ms; a candidate's sheet, 120ms (`fade-in`)                                               |
| A list arriving                              | rows rise in one after the other, 320ms, 40ms apart, once (`stagger` + `rise-in`); never on a refresh             |
| A control pressed                            | it gives 2 percent, 120ms (`press`)                                                                               |
| A row under the pointer                      | its tint (`hover`), 120ms                                                                                         |
| The section changing on the rail             | the ink fill passes to the new item, 120ms (`press`)                                                              |
| A segmented control                          | the thumb slides to the chosen option, 180ms                                                                      |
| A dialog opening                             | fades, scales from 96 percent and rises 8px with a gentle spring, 240ms; leaves in 180ms                          |
| A drawer opening (the thread below `lg` too) | slides in from its edge, 240ms; the scrim fades                                                                   |
| The thread pane opening from `lg`            | it appears in place: beside the detail from `xl`, over its right side with the float shadow between `lg` and `xl` |
| A menu, a popover, a tooltip                 | fades and scales from 95 percent toward its trigger, 180ms (tooltip 120ms)                                        |
| Work running                                 | the bar's width eases to its value and a sheen crosses it (`shine`); indeterminate when the size is unknown       |
| A photo loading                              | it fades in over the initials, 240ms                                                                              |
| A theme change                               | one viewport cross-fade (view transition), component transitions frozen meanwhile                                 |

Nothing moves on every re-render, nothing loops except the sheen of a
running bar and the shimmer of a skeleton. `prefers-reduced-motion`
neutralises every transition and animation through one rule in
`styles.css` (the tokens are the only path).

## Icons

lucide only, stroke 1.75. 16px in buttons, rows, pills (14px) and menu
items; 20px in the navigation and page headers; 24px in an
empty state's disc. One icon per control: a button with the `icon` prop
never also has an icon child; a pill has a dot or an icon; a select
trigger has its one chevron; a menu item has one leading icon and, if
anything, text on the right. Every icon-only button carries an
`aria-label`; every decorative icon `aria-hidden`.

| Meaning                | Icon                | Meaning                                     | Icon           |
| ---------------------- | ------------------- | ------------------------------------------- | -------------- |
| upload CVs             | `Upload`            | add a person by hand                        | `UserPlus`     |
| a brief                | `Briefcase`         | a shortlist                                 | `ListChecks`   |
| share, send a dossier  | `Share2`            | run the analysis                            | `Sparkles`     |
| present (the dossier)  | `Presentation`      | a deeper look                               | `FileSearch`   |
| set aside              | `Archive`           | similar profiles                            | `Users`        |
| print                  | `Printer`           | stop                                        | `Square`       |
| resume                 | `Play`              | retry                                       | `RefreshCw`    |
| quota, waiting         | `Hourglass`         | a photo                                     | `Image`        |
| a document, a CV       | `FileText`          | consent, GDPR                               | `ShieldCheck`  |
| delete, erase          | `Trash2`            | archive                                     | `Archive`      |
| edit                   | `Pencil`            | save                                        | `Check`        |
| cancel, close          | `X`                 | search                                      | `Search`       |
| filter                 | `SlidersHorizontal` | sort                                        | `ArrowUpDown`  |
| back                   | `ArrowLeft`         | more actions                                | `Ellipsis`     |
| retained               | `Check`             | dismissed                                   | `X`            |
| partially met          | `Minus`             | not stated                                  | `CircleHelp`   |
| the dashboard          | `LayoutDashboard`   | activity                                    | `Activity`     |
| the talent pool        | `Users`             | settings                                    | `Settings`     |
| a comment              | `MessageSquare`     | a mention                                   | `AtSign`       |
| copy a link            | `Copy`              | an email                                    | `Mail`         |
| in processing          | `CircleDashed`      | open elsewhere (a new tab, outside the app) | `ExternalLink` |
| a profile (in the app) | `UserRound`         | more information                            | `Info`         |
| add to the shortlist   | `ListPlus`          | examine again                               | `RotateCcw`    |
| the team               | `UsersRound`        | a personal space (the person)               | `UserRound`    |
| the phone's menu       | `Menu`              | the theme (what it switches to)             | `Moon`, `Sun`  |
| the language           | `Languages`         | sign out                                    | `LogOut`       |

Known doubles to purge, and what replaces them:

- A `Button` with both the `icon` prop and an svg child → the `icon` prop
  alone (the primitive now drops or hides the child).
- A `SelectTrigger` with a `ChevronDown` child next to the one it draws →
  the trigger's own chevron (a child chevron is now hidden).
- A `Pill` with `dot` and an icon child → `icon` alone (the dot is not
  drawn when an icon is given).
- A `DropdownMenuItem` with a leading and a trailing icon → one leading
  icon, text (a role, a shortcut) on the right.
- Two `Avatar`s for the same person in one row (the list row and its
  hover card) → one.

## Content rules

Go to the essential, everywhere. A screen shows facts and actions, not
explanations: the product is easy to use because there is little to
read.

- **What a screen may say.** A title, its key figures, the labels of its
  fields and the words of its actions. No description paragraph under a
  page title or a section title (a page title and its figure say
  enough); no help sentence under a field, a button or a block, unless
  an error, a destructive action or a legal obligation needs it; no
  method or reassurance sentence ("we analysed…", "don't worry…"); a
  fact said once per screen, never repeated in a sentence beside the
  figure or the pill that already says it.
- **The tooltip rule.** The rare explanation that really matters (how a
  measure is computed, what a role may do, how long a link lasts) moves
  behind an `InfoTip` beside the title or the label it is about: one
  sentence, on demand. A `title` attribute is never the only place a
  sentence lives.
- **Figures first.** Numbers before words: "12 correspondances", "3 / 8
  exigences", "0 candidat", never "Nous avons trouvé 12 profils qui…". A
  count of one says "1 retenu" (each plural has its `.one` key).
- **Labels** of one to three words: a button says its action ("Importer
  des CV", "Partager"), a field its value ("Langue de travail"), a tab
  its view; the count in a tab or a chip is set apart for assistive
  technologies (`<span class="sr-only">, </span>`).
- **Empty states**: an icon, a title of a few words ("Aucune shortlist")
  and the one action that fills the list; at most one short line, and
  usually none. An error state is the same shape: the icon, what failed,
  "Réessayer".
- **Toasts** of a few words ("Enregistré.", "Lien créé."); an error toast
  says what to do when the person can do something.
- **Confirmations** state the consequence in one line ("Le lien ne
  s'ouvrira plus, pour personne. C'est définitif.").
- **Honesty, in few words.** A value the CV does not state reads "Non
  renseigné" / "Not stated" in muted text (`t("common.unknown")`), never
  a dash, an empty cell or a zero. A model's proposal is marked as such
  by a short pill or label ("Lecture du modèle", "Proposé par le
  modèle", "Rédigé par le modèle"), never a paragraph. A decision shows
  who took it and when; a share says when it expires; a document that
  failed says why in one sentence (the service's own); a reading without
  a model says so ("Texte seul, sans modèle").
- A block exists only if it answers one of: who is this, does the
  profile fit, what is missing, who decided and when, what happens next.
  A list row shows what tells rows apart (the headline, the years, the
  three skills that matter for the brief, the verdict), never every
  field, and no pill that every row would carry ("Ouvert" on every open
  brief).
- Skills: at most eight chips in a row, the ones relevant to the brief
  first; the rest behind "N more" in the sheet, never a wall of chips.
- Sentences in both languages with the same meaning, plain, one idea
  each. No all-caps, no exclamation marks, no "AI magic". A key no screen
  uses any more leaves both languages.

## Accessibility

- Contrast AA on every text, in both themes, proven (see "The proof"):
  the ink and grey 500 on paper, on grey 50 (the thread pane), grey 100
  (a row under the pointer) and grey 150 (the selected row); paper on
  the ink; the second line of a toast on the inverse. Grey 400 is an
  outline, never text; no text sits on grey 200 or darker but the ink.
  A tone's text keeps AA on its own fill (paper on the ink, on grey 500)
  and `caution` is never filled at full strength.
- Focus is always visible: a 2px ink ring 2px off every control (off the
  rail's items and the filter chips too, so it shows on their ink fill),
  a 2px ink edge on a field, inset on a row and on a list that has
  focus.
- Secondary text is never faded by alpha to look lighter (a count, a
  duration): it is `text-muted-foreground` at full strength, lighter by
  weight, so it keeps AA on the card in both themes.
- Everything reachable by keyboard: dialogs and drawers trap focus and
  close on Escape, menus and the segmented control take arrow keys, the
  phone menu is a dialog. A list takes ArrowUp, ArrowDown, Home and End,
  and its selected row says `aria-current`; every pane is a labelled
  region, the rail a labelled navigation whose current section says
  `aria-current="page"`.
- Every icon-only button has an `aria-label`; every progress bar and
  meter a label, min, max and value; every ring and mark a text
  alternative; a photo has an empty `alt`; an Avatar beside the visible
  name is `decorative` (hidden), one standing alone is an image named
  after the person.
- A state is never conveyed by colour alone, and in this charter never
  by colour at all: a verdict is a shape, an icon and a word; a status
  pill has a dot or an icon; a switch tells its state by the side of its
  thumb.
- `prefers-reduced-motion` is respected globally; nothing requires motion
  to be understood.
- Text zooms: no fixed heights around text, `min-w-0` and wrapping
  everywhere a string may be long.

## Simplicity

Not a gas factory: a simple, fast product that reads at a glance.

- **One primary per view.** One ink-filled button in the header, the
  one thing the person came to do; a detail pane may fill the one action
  it is for ("Retenir" on a profile's reading, "Voir le CV" on a
  candidate's sheet); everything else is secondary, outline or ghost.
- **One click to the frequent action.** Running an analysis, adding to a
  shortlist, sending a dossier take one click, never a check step
  before; a confirmation exists only for what cannot be undone.
- **No figure said twice.** A count lives in the header's `meta`, in a
  segmented control or in the brief's state block, and nowhere else; no
  sentence beside the pill or the figure that already says it.
- **A pane rather than a page for a detail.** A profile of a brief or of
  the pool opens in the detail pane beside its list (full screen on a
  phone), and the URL keeps it (`?c=`), so a refresh or a shared link
  lands on the same row; a drawer is for a form, the CV, the similar
  profiles; a page is for an object of its own (a brief, a candidate).
- **A thread for the team on each object.** A brief, a candidate, a
  shortlisted candidate carry the team's thread, in the thread pane
  beside them (`ThreadPane`, `TeamThread`, with @mentions, live), and
  the dashboard's "À traiter" lists the mentions: the conversation
  happens next to the thing, not in a chat elsewhere.
- **Fewer elements.** No pill every row would carry, no ring where a
  figure says it, no meter where a word says it, no card in a card, one
  icon per control. What the model derived from the brief is internal,
  shown for transparency on demand, never a module to maintain.

## Page templates

The pages of v4. Every signed-in page is a `Workspace` and its panes; the
four sections of the rail are the four templates below, and every other
signed-in page is one fill pane. A colour named here reads through the
monochrome tones above.

- **Dashboard** (`/app`): the greeting as the title ("Bonjour Sara"),
  the date as meta, one filled "Nouveau brief" (outline while the pool
  is empty, where "Importer des CV" is the filled one; none while there
  is no brief, where the empty state carries it). A wide pane, "Mes
  briefs en cours" with its count and a ghost "Tous les briefs": the
  open briefs as 64px rows, the most recently active first, each the
  title and one line (what the newest analysis found, "3 retenus", who
  wrote last on the thread and the first words). A fill pane: "À
  traiter" (`MyMentions`, the messages that mention the person as rows,
  each leading to its object), then the pool's line (the profiles as a
  link, the CVs being read with their bar, "Importer des CV"). No thread
  pane, no stat tiles, no feed.
- **Briefs** (`/app/briefs`): the count as meta and, once a brief is
  closed, a `Segmented` filter (open, closed, all) beside it (in the
  pane's header on a phone), one filled "Nouveau brief"; one fill pane
  of 64px rows, each the title (with its status when it is not simply
  open), one line (what the newest analysis found, how many the
  shortlist retained, who wrote last and when) and the date from `sm`.
  A brief (`/app/briefs/:briefId`), the heart of the product, has three
  panes and keeps the group and the profile in its URL (`?g=`, `?c=`):
  - the header: "Briefs" as the eyebrow, the title, the status only when
    the brief is not open and the date of the last change as meta; the
    one filled button, "Analyser" then "Relancer" (held as "Analyse en
    cours" while a run goes; outline while the state block carries
    "Reprendre" or "Réessayer", while the matches' empty state carries
    it, and in the shortlist group once "Partager la shortlist" is the
    filled one), the `ThreadToggle`, a menu (Voir le brief, Modifier,
    Partages (N), Clore or Rouvrir, Supprimer le brief for an
    administrator).
  - the list pane (440px), its header kept in place: the consultant's
    brief folded to two lines with "Voir le brief" and "Modifier" as
    quiet links (the text and the form in drawers); the state block
    (`AnalysisState`, one `role="status"` region in every state, figures
    first: done, "12 correspondances", the figure in `stat-number`, and
    "1 093 analysés · 4 min" under it; running, "412 / 1 093 analysés",
    the bar of the whole run, the stage's word and "Interrompre"; queued,
    "En attente" over an indeterminate bar; stopped, "Interrompue · 412 /
    1 093" and a filled "Reprendre"; failed, "Échec" with its one line
    and a filled "Réessayer"; nothing yet, "Aucune analyse"; "Brief
    modifié · relancez" under any of them once the text changed); the
    four groups as a `Segmented` with their counts ("Correspondances 12 ·
    Proches 9 · Shortlist 3 · Écartés 1 069"). Then the group's rows,
    56px, each with the photo or the initials. A match or a near
    profile: the rank, the name, the position, the years and the place,
    the tier (`TierPill compact`; "À confirmer" while the second reading
    has not seen a match) and, beside the row for a member, the 32px
    button that puts it on the shortlist (a check once there). A
    shortlisted candidate: the position, the years, the score and who
    decided ("Sara B. retient", else "à examiner"), the tier and the
    decision as pills (Retenu the ink filled with a check, Écarté a grey
    outline with a cross and the row muted, À examiner an ink outline),
    then for a member the decisions that apply (Retenir and Écarter, or
    Réexaminer) and the item's thread with its count; above these rows,
    the filter chips Tous, À examiner, Retenus and Écartés with their
    counts. A profile set aside: the triage's verdict and its reason,
    "Lire quand même" for a member. The near profiles the screening
    scored and the profiles set aside come fifty at a time, "Suivants" at
    the foot of the pane. Skeleton rows of the same height before the
    rows land; a quiet empty state when a group is empty, never "none"
    while a run goes.
  - the reading pane (`ProfileReading`): the photo or the initials (64px,
    square-rounded), the name, one line of what the CV states (the
    position held today, the years, the place, the availability), then
    the tier, the score as a figure ("82 / 100") and "Lecture du modèle"
    ("Proche" for a near profile, the triage's verdict for one it set
    aside; on the shortlist the decision with who and when, "Retenu par
    Sara B." and the time, and "Lecture du modèle" moves to the model's
    sentence); for a member a filled "Retenir" and an
    outline "Écarter" (the decision taken becomes "Réexaminer"; "Lire
    quand même" for a profile the model did not read in full), then "Voir
    le CV" (read in place) and a ghost "Voir la fiche". Below, two columns
    from `md`, each block under its label: why this profile, the
    requirements of the brief with their evidence, the reading against
    the role (the five meters, the composite behind an `InfoTip`), the
    strengths, the reservations (the second reading's doubt first), the
    points for the interview, the triage's verdict in one muted line. One
    click retains or dismisses, from the row or the reading: a match
    enters the shortlist with its decision, never behind a confirmation.
  - the thread pane: the brief's thread; with a shortlisted candidate
    selected, a `Segmented` at its top switches to the candidate's (the
    default, again after each new selection).
- **Pool** (`/app/candidates`): "Vivier", the profiles as meta ("· 12 CV
  en traitement" while a wave runs), the search (at the top of the list
  below `lg`), "Filtrer" with its count (the filters in a popover), the
  one filled "Importer des CV", the `ThreadToggle` of the selected
  profile and a menu ("Ajouter à la main"). A wide pane: the sort as a
  `Segmented` (Séniorité, the default, then Récents and Nom), the
  processing line while something is pending or failed (the figure and
  the bar; the CVs waiting for the quota and the failed ones behind one
  toggle), fifty 60px rows a page (the photo or the initials, the name
  and the position held today, the seniority, the place and three
  skills, the date from `sm`), the page's figure with "Précédents" and
  "Suivants" at the foot. The detail: the `CandidateSheet` of the
  selected profile (`?c=`), its head (the photo, the name, "Directrice
  juridique chez Label'Vie · 19 ans · Casablanca", the languages and the
  availability, the pills that set the profile apart, the filled "Voir
  le CV" and a menu: Modifier, Profils proches, Exporter (JSON),
  Archiver or Réactiver, Effacer définitivement), then its blocks in two
  columns once the sheet is wide enough (its own width, not the
  viewport's): the summary, the
  career as a rail of positions, the education, the contact details and
  the links; the skills (eight and "+ N"), the documents, the five
  nearest profiles, the tags, the consent folded to one line. The thread
  pane follows the selected profile. The candidate's page
  (`/app/candidates/:candidateId`, where a row leads below `lg`) is the
  same sheet in one fill pane, `compact`: the name, its line and the
  actions are the Workspace header's; the thread pane beside it.
- **Team** (`/app/members`): "Équipe" (or "Espace personnel"), the
  members' count and the plan as meta (a personal space says instead
  "Inviter quelqu'un en fait une équipe"), one filled "Inviter" for an
  administrator (held while the seats are full), a menu with
  "Activité". The members as 64px rows (a wide pane for an
  administrator): the photo or the initials, the name over the email,
  the role (a `Select` for whoever may change it) and the removal
  beside the row. For an administrator a fill pane: the pending
  invitations as rows (the revocation beside) and the plan's two usages
  (a figure and a bar each). Every removal is confirmed.
- **One-pane pages**: the settings (the space, my account and the danger
  zone in a column of 48rem at most, under `label-caps` titles, the
  header's one filled "Enregistrer"), the activity (the families as
  chips in the pane's header, the rows by day), a new brief (the title
  and the text, "Créer et analyser" in the header), a new team, and the
  old address of a shortlist on its way to its brief.
- **Dialog** (a confirmation, a form): `size` by content (`sm` for a
  question, `lg` for a form with rows, `xl` for an upload with a table),
  `DialogHeader` with a title (a sentence only for a confirmation's
  consequence or a legal obligation), `DialogBody` scrolling,
  `DialogFooter` with cancel then the one confirming button. The share
  dialog is one such `lg` dialog in one step: a checklist, two optional
  fields, "Partager"; then the link with its copy button.
- **Drawer**: `SheetHeader` with the Avatar and the title, `SheetBody`
  scrolling, `SheetFooter` with the actions when the drawer decides
  something.
- **Public dossier** (`/share/:token`): a white sheet with dark ink on
  any theme (`share-sheet` scopes the tokens), A4 with a 16mm margin, a
  cover then one sheet per candidate per printed page
  (`print:break-before-page`), the initials alone (no photo), the score
  and the decision as text, "Lecture du modèle" once per sheet beside the
  synthesis, the print and CV buttons hidden in print (`print:hidden`).
  It says when the link expires; a sheet without an analysis says so
  instead of showing an empty table. The PDF a reader keeps is the
  browser's print of the page.

## The proof

Two tests hold the charter; CI runs them with the rest of `bun run test`.

- `src/lib/design/contrast.test.ts` reads `src/styles.css` itself, in
  both themes (`readTokens()` of `src/lib/design/contrast.ts`: the
  `:root` and `.dark` blocks, one `var()` resolved, comments skipped),
  and rates every pair the plane relies on with the WCAG 2.1 ratio: the
  text on the page, the filled action's and the toast's (12 at least);
  grey 500 on the page, on the selected row, on a row under the pointer
  and on the thread pane, `negative` on the page, the toast's second
  line and the initials on their disc (4.5); `ink-soft` on the selected
  row (7); and the edges a reader must see on the page: a line (1.2), a
  field's border (1.4), the selected row (1.08), the quiet outline
  (1.5), and the disc on the selected row (1.4). It also checks that
  every colour of `:root` has its `.dark` value and back, and that no
  `sidebar-` token is left. Its header says why v3 would have failed (no
  `hover` and no `thread` to rate) and gives the v3 and v4 figures.
- `src/lib/design/classes.test.ts` reads every `.tsx` file under `src`
  (the tests aside) and names each file and line that breaks the
  charter: a hard-coded colour class (`bg-white`, `text-black`, a
  Tailwind grey scale), a hex value outside `src/styles.css` and the
  root route's theme-color meta, a `sidebar-` token, `max-w-6xl` on a
  signed-in page, `text-caution-foreground` on a full-strength
  `bg-caution`, `text-background` without `bg-ink` on the same line, a
  `sheet` class on a signed-in page or in the thread and activity
  blocks, a `PageHeader` on a signed-in page.

A token changed in `styles.css` that breaks a pair fails the first; a
screen that steps out of the plane fails the second.
