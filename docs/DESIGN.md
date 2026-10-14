# Vivier design charter, v2

Vivier is a professional tool HR teams use for hours: a talent pool, a
brief, a shortlist built together, a dossier sent to a manager. The look
is the one of a product people pay for: calm, precise, generous
whitespace, a strong typographic hierarchy, one accent, motion with a
purpose. Every block on a screen earns its place by helping a recruiter
decide; what does not, goes. This page is the contract every screen
follows. The tokens live in `src/styles.css`, the primitives in
`src/components/ui` (shadcn, restyled) and `src/components/app-shell`.

## Principles

1. **One object.** Every page is built from the same skeleton (header,
   sections, sheets, rows) and the same primitives, so the product feels
   like one thing, not twelve screens.
2. **Hierarchy before decoration.** Size, weight and spacing carry the
   structure. Colour is reserved: one accent for the action, four tones
   for meaning. No grey boxes in white boxes, no borders where a gap
   does the job.
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
component never hard-codes a colour, a shadow, a duration or a radius.

### Colour

| Token                                   | Light                         | Role                                            |
| --------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `background`                            | warm off-white, oklch 0.985   | the page                                        |
| `card`, `popover`                       | white                         | sheets, menus, dialogs                          |
| `border` / `line`                       | black at 9 percent            | hairlines (dark: white at 10 percent)           |
| `input`                                 | black at 14 percent           | field borders                                   |
| `ink`, `foreground`                     | near-black green              | text                                            |
| `muted-foreground`                      | oklch 0.49 (AA on white)      | secondary text, labels                          |
| `muted`, `secondary`, `accent`          | warm greys                    | tracks, hover tints, selected rows              |
| `primary`                               | deep green, oklch 0.45 (AA)   | the one main action, links, active nav, rings   |
| `positive` / `caution` / `negative`     | green / amber / red           | met, retained / partial, to check / missing     |
| `neutral`                               | grey                          | not stated (never a judgement)                  |
| `scrim`                                 | near-black at 40 percent      | under a dialog or drawer (dark: 70 percent)     |
| `destructive`                           | red                           | erase, delete                                   |
| `sidebar-*`                             | a shade under the page        | the sidebar surface, its hover and borders      |

Tints are the token at an alpha (`bg-primary/10`, `bg-positive/12`), so
dark mode follows on its own. Semantic tones are reserved for meaning:
never for decoration, never alone (always with an icon, a dot or a word).

### Elevation, radii, layers

| Scale    | Steps                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Shadows  | `shadow-hairline` (a sheet), `shadow-raised` (a lifted card, a filled button), `shadow-float` (menus, popovers, toasts), `shadow-dialog` (dialogs, drawers) |
| Radii    | `rounded-sm` 8 (menu items, tooltips, small discs), `rounded-md` 12 (nav items, inputs' siblings), `rounded-lg` 16 (sheets, textareas), `rounded-xl` 24 (dialogs), `rounded-full` (buttons, pills, fields) |
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

- The shell: a 264px sidebar (the brand, the organisation switcher with
  the plan pill, five sections with 20px icons and one active mark that
  slides to the current section, the person at the bottom). On phones a
  64px top bar and a full-screen sheet menu, closed on navigation.
- The content column: `max-w-6xl` (72rem) centred, 16px of horizontal
  padding on phones, 32px from `sm`, 40px from `lg`, 32px of vertical
  padding. Every page change fades the column in and rises it 6px
  (`PageTransition`, keyed on the pathname).
- Nothing narrower than its content: every flex child that may hold a
  long string gets `min-w-0` and the string `truncate` (file names,
  emails, URLs); tables scroll horizontally inside their card, never the
  page.
- Two columns from `lg` only when the second one earns it (an activity
  feed next to a card of steps, a profile next to its verdicts).

## Components

Every primitive keeps its earlier props; the new ones are optional.

### `src/components/ui`

- **Button** `variant` primary (= default) · secondary · outline · ghost ·
  destructive · link; `size` sm 32 · md 40 (= default) · lg 44 · icon ·
  icon-sm; `icon` the one leading 16px icon (a literal `<svg>` child is
  dropped and the svg of a child component is hidden, so a button can
  never show two; children that are not icons stay); `asChild`. Press
  feedback on every variant (`press`: 2 percent under the finger). At
  most one filled primary per view.
- **Input, Textarea, Select** 40px, pill-shaped fields on the card colour,
  the ring on focus. The Select trigger draws its one chevron; a caller
  never adds another.
- **Dialog** `size` sm 28rem · md 32rem · lg 42rem · xl 56rem, 32px of
  padding, `overflow-hidden`; slots `DialogHeader`, `DialogBody` (the
  part that scrolls), `DialogFooter` (buttons wrap, stacked on a phone).
  Springs in over 240ms, leaves in 180ms. The close button is a 40px
  target and the content's last child.
- **Sheet** (drawer) `side`, `size` md 32rem · lg 44rem · full (the
  viewport minus a gutter, for the CV viewer); slots `SheetHeader`,
  `SheetBody` (give the content `flex flex-col gap-6 overflow-hidden` to
  pin the header and footer), `SheetFooter`.
- **Tabs** a 40px muted track with pill triggers, the active one lifted;
  **Segmented** the same track without panels, `value`/`onChange`/
  `options` (label, one icon, a count in muted text at full strength,
  lighter by weight), a thumb that slides, arrow keys.
- **Tooltip** ink on light, 13px, one line; the provider is mounted at
  the root. A tooltip never replaces an `aria-label`.
- **DropdownMenu, Popover, Command** the float surface; items 36px with
  one leading icon at most; `destructive` on an item for erase. Menus
  open above drawers (`z-popover`).
- **Skeleton, SkeletonRows** shimmering placeholders the size of what
  they stand for (`avatarSize` sm · md · lg matches the Avatar the rows
  will show); `SkeletonRows` is the list every page shows before its
  rows arrive.
- **Toaster** the float surface, an icon in a tinted disc, bottom right,
  above everything.

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
- **Pill** `tone` neutral · positive · caution · negative · primary;
  `dot` or `icon` (14px), never both: `icon` wins; `size` sm 20 · md 24.
- **Avatar** `name`, `size` sm 28 · md 36 · lg 44 · xl 72, `photoUrl` (a
  signed URL; the initials stay under the photo until it loads, then it
  fades in; a failed photo leaves the initials), `variant` disc · profile
  (square-rounded, for a candidate sheet), `decorative` (beside the
  visible name: hidden from assistive technologies, so the name is not
  read twice). The photo identifies a person in the interface only and
  never reaches a model.
- **StatTile** `label` (wraps to two lines, never truncated), `value`
  (null draws a dash with the reason on hover and as its text for
  assistive technologies, never a zero), `icon` (its disc shows from
  `sm`), `to`, `loading`, `progress` (a 4px bar
  with a sheen while it runs), `hint`. **StatGrid** staggers its tiles.
- **ProgressBar** `value` (null = indeterminate), `max`, `size` sm 4px ·
  md 6px, `active` (the sheen), `tone`, `label` (required, for assistive
  technologies). The width eases over 320ms.
- **Meter** `label`, `value` (null reads "Non renseigné" and the bar is
  decoration: no meter role without a value), `max`, `hint`, `tone`
  primary · score (coloured like the ring), `name` (the accessible name
  when `label` is a node). For the five dimensions of an assessment.
- **Timeline, TimelineItem** `when`, `title`, `subtitle`, `current`,
  children: a vertical rail with dots, dates on the left from `sm`,
  items rising in one after the other. For the experiences.
- **ScoreRing** `score` 0–100 or null (a dash), `label`, `size` sm 40 ·
  md 56 · lg 72, `static` (the public dossier: drawn at rest for print).
  Green from 80, amber from 60, red below. The arc draws itself once.
- **RequirementList, RequirementMark** one row per requirement: the mark
  (✓ met, – partial, ✗ missing, ? not stated, each with a text
  alternative), the label, the evidence; `compact` for print, `stagger`
  for rows that rise in once on screen.
- **EmptyState** `icon` (in a tinted disc), `title` (a few words),
  `text` (optional, at most one short line; usually not passed),
  `action` (one), `compact` inside a card or a drawer (the title a
  paragraph: the card's own title is the heading), `inset`
  inside a sheet (no card of its own, never a card in a card).
- **FilterChip** `active`, `onClick`, `icon`, `count`, `expanded` and
  `controls` (a chip that shows a panel says open or closed, not
  pressed); 40px like the field and the tabs beside it, hairline, accent tint when on, never the
  filled primary; the count at full strength, lighter by weight only.
  **LocaleChips** the two languages, one on, each name in its own
  language (`lang`).
- **ConfirmDialog** a small dialog, cancel then the one confirming
  button (negative when `destructive`), `busy` disables both.
- **PageTransition** wraps the outlet; **usePrefersReducedMotion** for
  code that drives a timer.

### Utilities (`src/styles.css`)

`sheet` (a card: hairline, white, 16px corners), `sheet-row` (a roomy
row, hairline between rows, tint on hover when it leads somewhere),
`sheet-link` (a card that leads somewhere: tint, accent border, lift,
the ring outside on focus), `label-caps`, `stat-number`, `font-display`,
`skeleton`, `surface-float`, `surface-dialog`, `brand-text`; motion:
`press`, `lift` (the hover lift and the focus ring alone, for a linking
surface that is not a sheet; never with `sheet-link`), `rise-in`,
`fade-in`, `page-enter`,
`stagger`, `shine`, `animate-indeterminate` (a bar whose size is
unknown), `duration-*`; layers: `z-*`; `share-sheet` for the
public dossier only. Hiding a control in print is Tailwind's
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

- Contrast AA: ink and muted text on white and on the card, primary on
  white, white on primary, a tone's text on its own tint (a pill); tints
  never carry text alone.
- Focus is always visible: a 2px ring in the accent on every control,
  inset on rows that are links, outside on cards that are links
  (`sheet-link`).
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
- Colour is never the only signal: a verdict is an icon and a word in a
  tone; a status pill has a dot or an icon.
- `prefers-reduced-motion` is respected globally; nothing requires motion
  to be understood.
- Text zooms: no fixed heights around text, `min-w-0` and wrapping
  everywhere a string may be long.

## Page templates

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
