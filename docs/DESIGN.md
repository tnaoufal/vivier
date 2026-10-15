# Vivier design charter, v3: Blackweaver monochrome

Vivier is a professional tool HR teams use for hours: a talent pool, a
brief, a shortlist built together, a dossier sent to a manager. The look
is the one of every Blackweaver project: black and white. One ink on
paper, greys for surfaces and secondary text, no accent colour anywhere,
a strong typographic hierarchy, generous whitespace, motion with a
purpose. Every block on a screen earns its place by helping a recruiter
decide; what does not, goes. This page is the contract every screen
follows. The tokens live in `src/styles.css`, the primitives in
`src/components/ui` (shadcn, restyled) and `src/components/app-shell`.

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
   from the other end (`.dark`), the same shapes, the same words. A
   component never knows which theme it is in.

## Principles

1. **One object.** Every page is built from the same skeleton (header,
   sections, sheets, rows) and the same primitives, so the product feels
   like one thing, not twelve screens.
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
   gutters and no horizontal scroll; from `sm` it spreads into columns.

## Tokens (`src/styles.css`)

Every token exists in light and in dark (`.dark` mirrors `:root`); a
component never hard-codes a colour, a shadow, a duration or a radius. A
hex value appears in `src/styles.css` and nowhere else.

### The scale

| Grey       | Value     | Used for (light)                                                                    |
| ---------- | --------- | ----------------------------------------------------------------------------------- |
| paper      | `#FFFFFF` | the page, cards, menus, dialogs; the text on an ink fill                            |
| 50         | `#FAFAFA` | the sidebar                                                                         |
| 100        | `#F4F4F4` | `muted`, `secondary`, `accent`: hover tints, the segmented track, discs            |
| 200        | `#E6E6E6` | `border`, `track`: 1px borders, the track under a bar or a ring                     |
| 300        | `#D4D4D4` | `input`: field borders, the off switch                                              |
| 400        | `#A3A3A3` | `neutral`: the quiet outline of a dismissed mark; the second line of a toast        |
| 500        | `#6F6F6F` | `muted-foreground`, `negative`: secondary text, AA on paper, grey 50 and grey 100   |
| 700        | `#3D3D3D` | `ink-soft`, `caution`                                                               |
| ink (900)  | `#0A0A0A` | text, `primary`, `ring`, `positive`, `destructive`                                  |

### Colour

| Token                                            | Light                                | Dark                                 | Role                                                            |
| ------------------------------------------------ | ------------------------------------ | ------------------------------------ | --------------------------------------------------------------- |
| `background`                                     | `#FFFFFF`                            | `#0A0A0A`                            | the page                                                        |
| `foreground`, `ink`                              | `#0A0A0A`                            | `#FAFAFA`                            | text                                                            |
| `ink-soft`                                       | `#3D3D3D`                            | `#D4D4D4`                            | the sidebar's links at rest                                     |
| `card`                                           | `#FFFFFF`                            | `#0A0A0A`                            | sheets                                                          |
| `popover`                                        | `#FFFFFF`                            | `#0F0F0F`                            | menus, popovers, dialogs, drawers                               |
| `border`, `line`                                 | `#E6E6E6`                            | `#262626`                            | 1px borders, hairlines                                          |
| `track`                                          | `#E6E6E6`                            | `#262626`                            | under the ink of a bar or a ring                                |
| `input`                                          | `#D4D4D4`                            | `#333333`                            | field borders, the off switch                                   |
| `muted`, `secondary`, `accent`                   | `#F4F4F4`                            | `#171717`                            | hover tints, the segmented track, discs, the secondary button   |
| `muted-foreground`                               | `#6F6F6F`                            | `#A3A3A3`                            | secondary text, labels                                          |
| `primary` / `primary-foreground`                 | `#0A0A0A` / `#FFFFFF`                | `#FAFAFA` / `#0A0A0A`                | the one main action, the active mark, a chip that is on         |
| `ring`                                           | `#0A0A0A`                            | `#FAFAFA`                            | the focus ring                                                  |
| `destructive` / `destructive-foreground`         | the ink / paper                      | paper / the ink                      | erase: the confirm dialog and the word carry the consequence    |
| `positive` / `positive-foreground`               | `#0A0A0A` / `#FFFFFF`                | `#FAFAFA` / `#0A0A0A`                | met, retained, tier A                                           |
| `caution` / `caution-foreground`                 | `#3D3D3D` / `#0A0A0A`                | `#D4D4D4` / `#FAFAFA`                | partial, to check: an outline tone (see below)                  |
| `negative` / `negative-foreground`               | `#6F6F6F` / `#FFFFFF`                | `#A3A3A3` / `#0A0A0A`                | missing, dismissed                                              |
| `neutral`                                        | `#A3A3A3`                            | `#6F6F6F`                            | the quiet outline of a `no` mark or a negative pill             |
| `inverse` / `-foreground` / `-muted-foreground`  | `#0A0A0A` / `#FFFFFF` / `#A3A3A3`    | `#FAFAFA` / `#0A0A0A` / `#6F6F6F`    | a toast, a tooltip                                              |
| `scrim`                                          | the ink at 40 percent                | black at 70 percent                  | under a dialog or a drawer (a veil darkens in both themes)      |
| `sidebar`, `sidebar-border`, `sidebar-accent`    | `#FAFAFA`, `#E6E6E6`, `#E6E6E6`      | `#0F0F0F`, `#262626`, `#262626`      | the sidebar, its hairlines, its hover                           |

A tint is the token at an alpha (`bg-ink/10`: one step darker under the
pointer; `bg-caution/10`: a grey wash under a sentence), so dark mode
follows on its own; a tint never carries text alone. `::selection` is
the ink at 14 percent.

### The three tones

| Tone       | As a pill or a mark                                               | As text on the card                                              | As a fill                                             |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `positive` | the ink filled, paper text and mark                               | the ink                                                          | `bg-positive text-positive-foreground`                |
| `caution`  | a 1px ink outline, ink text and mark                              | `text-caution-foreground` (the ink) or `text-caution` (grey 700) | never at full strength: `bg-caution/10` with ink text |
| `negative` | a 1px grey 400 outline (`border-neutral`), grey 500 text and mark | grey 500 (`text-negative`)                                       | `bg-negative text-negative-foreground`                |
| `neutral`  | a grey 100 fill, grey 500 text                                    | grey 500                                                         | the not stated: never a judgement                     |

A tone never travels alone: a pill carries an icon or a dot (implied for
a verdict tone), a mark is an icon with a text alternative, a sentence
says the word. The old accent tone `primary` of the Pill is kept for
the call sites and draws like `caution`.

### Elevation, radii, layers

| Scale    | Steps                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Shadows  | `shadow-hairline` 0 1px 0 black at 6 percent (a sheet, with its 1px border), `shadow-raised` 0 2px 8px at 8 percent (a card lifted on hover), `shadow-float` 0 8px 24px at 10 percent (menus, popovers, toasts), `shadow-dialog` 0 16px 48px at 12 percent (dialogs, drawers); every floating surface also has a 1px border, and no button has a shadow; dark deepens the alphas |
| Radii    | `rounded-sm` 6 (menu items, tooltips, small discs), `rounded-md` 8 (nav items, the organisation switcher), `rounded-lg` 12 (sheets, textareas, toasts), `rounded-xl` 16 (dialogs, drawers), `rounded-full` (buttons, pills, fields); nothing rounder than 16 but the pill |
| Layers   | `z-sticky` 20 (sticky headers), `z-overlay` 40 (the scrim), `z-modal` 50 (dialog, drawer), `z-popover` 60 (menus above a drawer), `z-toast` 70 |

### Type

Geist for everything, Poppins 600 (`font-display`) for display titles
only. Sentence case everywhere; no all-caps. Numbers in `tabular-nums`.

| Utility     | Size / line | Use                                             |
| ----------- | ----------- | ----------------------------------------------- |
| `text-xs`   | 12 / 16     | pills, shortcuts                                |
| `text-meta` | 13 / 20     | labels, meta lines, dates, hints (`label-caps`) |
| `text-sm`   | 14 / 20     | secondary text, rows' second line, buttons      |
| `text-body` | 15 / 24     | body, a dialog's consequence line               |
| `text-base` | 16 / 24     | card titles (600)                               |
| `text-lg`   | 18 / 28     | compact empty-state titles                      |
| `text-xl`   | 20 / 28     | section titles, dialog titles, sticky headers   |
| `text-2xl`  | 24 / 32     | page titles on phones                           |
| `text-3xl`  | 30 / 36     | page titles (`font-display`), `stat-number`     |
| `text-4xl`  | 36 / 40     | the landing page's hero on a phone              |
| `text-5xl`  | 48 / 1      | reserved                                        |
| `text-6xl`  | 60 / 1      | the hero from `sm`, the 404 number              |

No sentence under a page title: the title and its key figure (in `meta`)
say enough (see "Content rules").

### Spacing

An 8px grid: 32px between page sections (`space-y-8`), 24px between cards
in a grid (`gap-6`) and inside a card (`p-6`), 16px between cards stacked
in one column (`space-y-4`: a board column, the dashboard's briefs, the
results of an analysis), 16px of vertical padding per row (`py-4`), 8px
between a label and its field. Touch targets are
40px high; icon buttons 40 × 40; the 32px `sm` button lives only inside a
desktop row that already measures 40px or more.

### Motion

| Token                         | Value                     | For                                            |
| ----------------------------- | ------------------------- | ---------------------------------------------- |
| `duration-fast`               | 120 ms                    | hover, press, a colour change                  |
| `duration-base`               | 180 ms                    | menus, popovers, the page change, the nav mark |
| `duration-slow`               | 240 ms                    | dialogs and drawers entering                   |
| `duration-slower`             | 320 ms                    | rows rising in, a bar or a ring reaching its value |
| `ease-out-soft`               | cubic-bezier(.2,.7,.2,1)  | everything that settles                        |
| `ease-spring`                 | cubic-bezier(.34,1.3,.64,1) | a dialog entering (a gentle overshoot, 4 percent) |
| `--stagger`                   | 40 ms                     | the wait between two rows of a list            |

`src/lib/motion.ts` carries the same numbers for code that drives a
timer (`DURATION`, `staggerDelay`, `staggerVars`) and the reading of the
reduced-motion preference (`prefersReducedMotion`, `subscribeReducedMotion`;
the hook `usePrefersReducedMotion` lives in `app-shell/page-transition`).

## Layout

- The shell: a 264px grey 50 sidebar (the brand in the ink, the
  organisation switcher with the plan pill, five sections with 20px
  icons and one ink mark, paper text over it, that slides to the current
  section, the person at the bottom). On phones a 64px top bar and a
  full-screen sheet menu, closed on navigation.
- The content column: `max-w-6xl` (72rem) centred, 16px of horizontal
  padding on phones, 32px from `sm`, 40px from `lg`, 32px of vertical
  padding. Every page change fades the column in and rises it 6px
  (`PageTransition`, keyed on the pathname).
- Nothing narrower than its content: every flex child that may hold a
  long string gets `min-w-0` and the string `truncate` (file names,
  emails, URLs); tables scroll horizontally inside their card, never the
  page.
- Two columns from `lg` only when the second one earns it (an activity
  feed next to a card of steps, a profile next to its verdicts, the
  team's thread next to a brief).

## Components

Every primitive keeps its props from v2; the look is monochrome.

### `src/components/ui`

- **Button** `variant` primary (= default: the ink filled, paper text) ·
  secondary (grey 100, grey 200 under the pointer) · outline (1px ink) ·
  ghost · destructive (the same ink fill, with its icon: the
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
- **Tabs** a 40px grey 100 track with pill triggers, the active one a
  paper thumb with a 1px grey 200 edge and ink text; **Segmented** the
  same track without panels, `value`/`onChange`/`options` (label, one
  icon, a count in muted text at full strength, lighter by weight), a
  thumb that slides, arrow keys.
- **Tooltip** the inverse surface (the ink, paper text; paper on ink in
  dark), 13px, one line; the provider is mounted at the root. A tooltip
  never replaces an `aria-label`.
- **DropdownMenu, Popover** the float surface (paper, a 1px border);
  items 36px with one leading icon at most; `destructive` on an
  item for erase reads at medium weight with its icon in the ink. Menus
  open above drawers (`z-popover`).
- **Skeleton, SkeletonRows** grey 100 placeholders with a shimmer of the
  ink at 5 percent, the size of what they stand for (`avatarSize` sm · md
  · lg matches the Avatar the rows will show); `SkeletonRows` is the list
  every page shows before its rows arrive.
- **Toaster** the inverse surface (the ink, paper text, so it reads at
  once over any page), the icon alone at 16px (a check, or an alert for
  an error: the icon and the words tell them apart), bottom right, above
  everything.

### `src/components/app-shell`

- **PageHeader** `eyebrow`, `title` (30/36, 24/32 on phones),
  `description` (kept for compatibility, not passed: see "Content
  rules"), `meta` (a row of pills, the page's count with `role="status"`
  when a filter changes it), `actions`; `sticky` is the slim
  variant of a long page (20/28, under the top edge with a blur).
- **Section** `title`, `count`, `description` (optional, not passed),
  `action`, `id`.
- **InfoTip** `label` (the topic, added to the button's name "More
  information · …"), children (the sentence): the
  16px info icon in a 40px target that opens a small popover on click,
  tap or keyboard. The one place an explanation lives, beside the title
  or the label it is about; never a paragraph under it.
- **Pill** `tone` neutral (grey 100 fill) · positive (the ink filled,
  paper text) · caution (a 1px ink outline) · negative (a 1px grey 400
  outline, grey 500 text) · primary (kept for the call sites, draws like
  caution); `dot` or `icon` (14px), never both: `icon` wins, and a
  verdict tone without an icon draws the dot on its own (`dot={false}`
  withholds it, for a letter that is its own mark); `size` sm 20 · md 24.
- **Avatar** `name`, `size` sm 28 · md 36 · lg 44 · xl 72: a grey 100
  disc with the initials in the ink; `photoUrl` (a signed URL; the photo
  is shown in greyscale through `photo`; the initials stay under it
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
  other. For the experiences.
- **RequirementList, RequirementMark** one row per requirement: the mark
  (✓ met: an ink disc with a paper check; – partial: an ink outline; ✗
  missing: a grey outline; ? not stated: a grey 100 disc; each with a
  text alternative), the label, the evidence; `compact` for print,
  `stagger` for rows that rise in once on screen.
- **EmptyState** `icon` (in a grey 100 disc), `title` (a few words),
  `text` (optional, at most one short line; usually not passed),
  `action` (one), `compact` inside a card or a drawer (the title a
  paragraph: the card's own title is the heading), `inset`
  inside a sheet (no card of its own, never a card in a card).
- **FilterChip** `active`, `onClick`, `icon`, `count`, `expanded` and
  `controls` (a chip that shows a panel says open or closed, not
  pressed); 40px like the field and the tabs beside it, a 1px grey 300
  border at rest, the ink filled with paper text when on; the count at
  full strength, lighter by weight only. **LocaleChips** the two
  languages, one on, each name in its own language (`lang`).
- **ConfirmDialog** a small dialog, cancel then the one confirming
  button (the ink, `destructive` or not: the question and its sentence
  are the safety), `busy` disables both.
- **PageTransition** wraps the outlet; **usePrefersReducedMotion** for
  code that drives a timer.

### Elsewhere

- **Switch** (`team/switch`) and **ToggleSwitch** (`briefs/toggle-switch`)
  a 36 × 20 track in a 40px target: on, the ink with a paper thumb; off,
  grey 300 with an ink thumb (both AA, the thumb's side tells the state);
  the `switch` role.
- **TierPill** (`briefs/tier-pill`) `tier` A · B · C, `compact`: a
  monogram, the letter alone in a disc (A the ink filled, B an ink
  outline, C a grey outline), the readable name for screen readers and on
  hover.
- **DecisionPill** (`briefs/decision-pill`) `decision`: fit = the ink
  filled + `CircleCheck`, borderline = an ink outline + `CircleAlert`,
  no_fit = a grey outline + `CircleX`, unassessed = grey 100 +
  `CircleDashed`; `DECISION_LOOK` is the one map every decision reads.
- **BriefStatusPill** (`briefs/brief-status-pill`) `status`, `size`:
  open = an ink outline with a dot, closed = a grey outline, draft = a
  grey fill.
- **BrandMark, BrandIcon** the sprout in its circle and the wordmark,
  the ink on paper (paper on ink in dark); `gradient` is kept and draws
  the same ink.

### Utilities (`src/styles.css`)

`sheet` (a card: a 1px border, paper, a hairline shadow, 12px corners),
`sheet-row` (a roomy row, hairline between rows, tint on hover when it
leads somewhere), `sheet-link` (a card that leads somewhere: tint, a
border one step darker, lift, the ink ring outside on focus),
`label-caps`, `stat-number`, `font-display`, `skeleton`, `surface-float`,
`surface-dialog`, `brand-text` (the ink), `photo` (a candidate's photo in
greyscale); motion: `press`, `lift` (the hover lift and the focus ring
alone, for a linking surface that is not a sheet; never with
`sheet-link`), `rise-in`, `fade-in`, `page-enter`, `stagger`, `shine` (a
grey sheen), `animate-indeterminate` (a bar whose size is unknown),
`duration-*`; layers: `z-*`; `share-sheet` for the public dossier only
(paper and ink on any theme). Hiding a control in print is Tailwind's
`print:hidden`.

## Motion: what moves and why

| Moment                              | Motion                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| A page change                       | the column fades in and rises 6px, 180ms (`PageTransition`)                              |
| A list arriving                     | rows rise in one after the other, 320ms, 40ms apart, once (`stagger` + `rise-in`); never on a refresh |
| A control pressed                   | it gives 2 percent, 120ms (`press`)                                                      |
| A card that leads somewhere, hovered| it lifts 1px and its shadow with it (`sheet-link`, `lift`)                              |
| The section changing in the sidebar | the active mark slides to it, 180ms                                                      |
| A segmented control                 | the thumb slides to the chosen option, 180ms                                             |
| A dialog opening                    | fades, scales from 96 percent and rises 8px with a gentle spring, 240ms; leaves in 180ms |
| A drawer opening                    | slides in from its edge, 240ms; the scrim fades                                          |
| A menu, a popover, a tooltip        | fades and scales from 95 percent toward its trigger, 180ms (tooltip 120ms)               |
| Work running                        | the bar's width eases to its value and a sheen crosses it (`shine`); indeterminate when the size is unknown |
| A score ring mounting               | the arc draws itself once, 320ms (`static` for print)                                    |
| A photo loading                     | it fades in over the initials, 240ms                                                     |
| A theme change                      | one viewport cross-fade (view transition), component transitions frozen meanwhile        |

Nothing moves on every re-render, nothing loops except the sheen of a
running bar and the shimmer of a skeleton. `prefers-reduced-motion`
neutralises every transition and animation through one rule in
`styles.css` (the tokens are the only path), and `PageTransition` keeps
the page still.

## Icons

lucide only, stroke 1.75. 16px in buttons, rows, pills (14px) and menu
items; 20px in the navigation, page headers and stat tiles; 24px in an
empty state's disc. One icon per control: a button with the `icon` prop
never also has an icon child; a pill has a dot or an icon; a select
trigger has its one chevron; a menu item has one leading icon and, if
anything, text on the right. Every icon-only button carries an
`aria-label`; every decorative icon `aria-hidden`.

| Meaning                 | Icon            | Meaning                | Icon              |
| ----------------------- | --------------- | ---------------------- | ----------------- |
| upload CVs              | `Upload`        | add a person by hand   | `UserPlus`        |
| a brief                 | `Briefcase`     | a shortlist            | `ListChecks`      |
| share, send a dossier   | `Share2`        | run the analysis       | `Sparkles`        |
| present (the dossier)   | `Presentation`  | a deeper look          | `FileSearch`      |
| set aside               | `Archive`       | similar profiles       | `Users`           |
| print                   | `Printer`       | stop                   | `Square`          |
| resume                  | `Play`          | retry                  | `RefreshCw`       |
| quota, waiting          | `Hourglass`     | a photo                | `Image`           |
| a document, a CV        | `FileText`      | consent, GDPR          | `ShieldCheck`     |
| delete, erase           | `Trash2`        | archive                | `Archive`         |
| edit                    | `Pencil`        | save                   | `Check`           |
| cancel, close           | `X`             | search                 | `Search`          |
| filter                  | `SlidersHorizontal` | sort               | `ArrowUpDown`     |
| back                    | `ArrowLeft`     | more actions           | `Ellipsis`        |
| retained                | `Check`         | dismissed              | `X`               |
| partially met           | `Minus`         | not stated             | `CircleHelp`      |
| the dashboard           | `LayoutDashboard` | activity             | `Activity`        |
| the talent pool         | `Users`         | settings               | `Settings`        |
| a comment               | `MessageSquare` | a vote                 | `ThumbsUp` / `ThumbsDown` |
| copy a link             | `Copy`          | an email               | `Mail`            |
| in processing           | `CircleDashed`  | open elsewhere (a new tab, outside the app) | `ExternalLink` |
| a profile (in the app)  | `UserRound`     | more information       | `Info`            |

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

- Contrast AA on every text: the ink and grey 500 on paper, on grey 50
  and on grey 100; paper on the ink; grey 400 on the ink in dark. Grey
  400 is an outline, never text; no text sits on grey 200 or darker but
  the ink. A tone's text keeps AA on its own fill (paper on the ink, on
  grey 500) and `caution` is never filled at full strength.
- Focus is always visible: a 2px ink ring 2px off every control, a 2px
  ink edge on a field, inset on rows that are links, outside on cards
  that are links (`sheet-link`).
- Secondary text is never faded by alpha to look lighter (a count, a
  duration): it is `text-muted-foreground` at full strength, lighter by
  weight, so it keeps AA on the card in both themes.
- Everything reachable by keyboard: dialogs and drawers trap focus and
  close on Escape, menus and the segmented control take arrow keys, the
  phone menu is a dialog.
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

- **One primary per view.** One ink-filled button on a screen, the one
  thing the person came to do; everything else is secondary, outline or
  ghost.
- **One click to the frequent action.** Running an analysis, adding to a
  shortlist, sending a dossier take one click, never a check step
  before; a confirmation exists only for what cannot be undone.
- **No figure said twice.** A count lives in the header's `meta`, in the
  tab or in the band, and nowhere else; no sentence beside the pill or
  the figure that already says it.
- **A drawer rather than a page for a detail.** A result, a shortlisted
  candidate, a similar profile open in a `Sheet` and the page stays where
  the person was; a page is for an object with a URL to share.
- **A thread for the team on each object.** A brief, a candidate, a
  shortlisted candidate carry the team's thread (`TeamThread`, with
  @mentions, live), and the dashboard's "to handle" lists the mentions:
  the conversation happens next to the thing, not in a chat elsewhere.
- **Fewer elements.** No pill every row would carry, no ring where a
  figure says it, no meter where a word says it, no card in a card, one
  icon per control. What the model derived from the brief is internal,
  shown for transparency on demand, never a module to maintain.

## Page templates

The templates below are the ones of v2, kept in place; the page
engineers of evolution 6 rewrite them page by page (the brief complement
module leaves the brief page, the thread joins each object, the
dashboard gains "to handle"). A colour named in them reads through the
monochrome tones above.

- **List page** (the pool, the briefs, the shortlists): `PageHeader`
  with the one primary action; a filter row (`Segmented` or
  `FilterChip`s, a search `Input`); one `sheet` of `sheet-row`s, each row
  the link, rising in once; `SkeletonRows` while loading; `EmptyState`
  with the action that fills it; the count in the header's `meta`, never
  a sentence.
- **Detail page** (a candidate, a brief): `PageHeader sticky` on long
  pages with the title, `meta` pills (only what sets the record apart:
  archived, typed by hand, consent withdrawn) and the actions, kept in
  place while the page loads and when it fails;
  then two columns from `lg`: the identity and the verdicts on the left
  (Avatar `profile`, the headline, the Meters, the RequirementList), the
  evidence on the right (the Timeline of experiences, the skills, the
  languages, the documents); comments and history in their own sections
  below; the CV opens in a `Sheet size="full"`.
- **Board page** (a shortlist): `PageHeader` with the share action and
  no count pills (each column's heading carries its count); columns or
  grouped sections by decision (matching, to check, set aside collapsed,
  not analysed), each card a `sheet-link` with the Avatar, the
  ScoreRing `sm`, the missing required requirement named; a drawer for
  the item (`Sheet size="lg"`) with the profile, the verdicts, the note,
  the votes, the comments, the history.
- **Brief page** (`/app/briefs/:briefId`): `PageHeader sticky` with the
  title, the status and its date, the one filled action ("Lancer la
  recherche", held with a tooltip while an editor has unsaved edits) and
  the administrators' menu; then two `Tabs` kept in the URL
  (`?tab=matches|brief`), both panels mounted: "Correspondances", its
  count in the tab, and "Le poste" (the brief, the role profile and the
  criteria in one `max-w-3xl` column). The matches tab, top to bottom and
  nothing else:
  - the **analysis band**, one `sheet` in the state the analysis is in.
    Idle: the count of matches as the headline (`font-display`), one line
    of figures under it ("analysés · retenus au tri · lus en détail"
    while some are left, then the date), the method behind an `InfoTip`,
    the earlier analyses behind a quiet button (the tiers are on the
    rows, never counted again in the band); once done, the profiles the
    pool gained since and "Analyser". Running: the live count first
    (`aria-live`, "Préparation du vivier…" while the search is
    prepared) with "Interrompre", then a `ProgressBar` with "{step} ·
    {done} / {total}" and the time left once known. Unfinished: what is
    left and "Reprendre", or "En cours dans une autre session". Waiting for the
    team's check: one line and "Vérifier le poste". No match once
    everything ran: "0 correspondance", the requirement most often
    missing and "Revoir le poste". An empty pool: `EmptyState` with the
    import.
  - the **match rows**, the matches alone in one `sheet` of compact rows:
    the rank, the `Avatar md`, the name and the position held today, one
    line (why it ranks there), the `TierPill compact` from `sm`, the
    `ScoreRing sm`; the row is one button, the shortlist button sits
    beside it, never inside. Rows rise in as their batch lands and never
    again; skeleton rows of the same height hold the place before.
  - right under them, a quiet toggle (`aria-expanded`) for the near
    profiles: muted rows, no tier, their main reservation as the line. A
    profile set aside is a figure of the band, never a row.
  - the **drawer** (`Sheet size="lg"`, from the right): the `Avatar lg`,
    the name, the position held today, the tier, the decision (only when
    it is not "Correspond") and the score in its header, previous and
    next (and the arrow keys), one row of actions (add to the shortlist,
    open the profile); then why this profile (the tiering's note first),
    the requirements with their evidence, the strengths and the
    reservations side by side, the reading against the role, the
    interview points, and the triage's verdict, small and muted.
- **Dialog** (a confirmation, a form): `size` by content (`sm` for a
  question, `lg` for a form with rows, `xl` for an upload with a table),
  `DialogHeader` with a title (a sentence only for a confirmation's
  consequence or a legal obligation), `DialogBody` scrolling,
  `DialogFooter` with cancel then the one confirming button.
- **Drawer**: `SheetHeader` with the Avatar and the title, `SheetBody`
  scrolling, `SheetFooter` with the actions when the drawer decides
  something.
- **Public dossier** (`/share/:token`): a white sheet with dark ink on
  any theme (`share-sheet` scopes the tokens), A4 with a 16mm margin, one
  sheet per candidate per printed page (`print:break-before-page`), the
  ring drawn at rest (`static`), the print and CV buttons hidden in print
  (`print:hidden`). It says when the link expires; a sheet without an
  analysis says so instead of showing an empty table. The PDF a reader
  keeps is the browser's print of the page.
