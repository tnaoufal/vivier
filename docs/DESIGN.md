# Vivier design charter

Vivier is a professional tool used for hours by HR teams. The look is
modern, calm and airy: generous whitespace, one accent colour, hairline
borders, large readable type, nothing cramped and nothing clipped. Every
page follows the same skeleton so the product feels like one object.
This page is the contract every screen follows; the tokens live in
`src/styles.css`, the shared pieces in `src/components/app-shell`.

## Layout

- Content column: `max-w-6xl` (72rem) centred, horizontal padding 16px on
  phones, 32px from `sm`, 40px from `lg`. Vertical padding 32px top.
- Sidebar 256px, sticky, with the organisation at the top, five sections,
  the person at the bottom. On phones a top bar and a full-screen menu.
- Vertical rhythm: 8px grid. Gap between page sections 32px (`space-y-8`),
  between cards in a grid 24px (`gap-6`), inside a card 24px padding
  (`p-6`), between a label and its field 8px, between rows 0 with a 1px
  divider and 16px vertical padding per row (`py-4`).
- Nothing narrower than its content: every flex child that may hold a long
  string gets `min-w-0` and the string `truncate` (file names, emails, URLs);
  tables scroll horizontally inside their card (`overflow-x-auto`), never the
  page. A dialog is `max-w-2xl`, padding 32px, `overflow-hidden`, with the
  scrolling list inside it (`max-h-[60vh] overflow-y-auto`) and a footer whose
  buttons wrap on narrow screens.
- Touch targets at least 40px high; icon buttons 40×40.

## Typography

Geist for everything, Poppins 600 for display titles only.

| Role | Size / line | Weight |
| --- | --- | --- |
| Page title | 30 / 36 (`text-3xl`), 24 / 32 on phones | display 600 |
| Section title | 20 / 28 (`text-xl`) | 600 |
| Card title | 16 / 24 (`text-base`) | 600 |
| Body | 15 / 24 (`text-[15px] leading-6`) | 400 |
| Secondary | 14 / 20 (`text-sm`) | 400, muted |
| Label, meta | 13 / 20 (`text-[13px]`) | 500, muted |

Sentence case everywhere; no all-caps. Numbers in `tabular-nums`. One
sentence of description under every page title, at most two lines.

## Colour

- Page `bg-background` (off-white, slightly green), cards `bg-card` (pure
  white) with `border-border` hairlines; dark mode mirrors this with deep
  green-black surfaces. No grey boxes inside white boxes: use hairlines and
  spacing to separate, tints (`bg-muted/50`) only for a selected or hovered
  row.
- The accent (`primary`, deep green) is for the one main action of a page,
  links, the active navigation item and focus rings. At most one filled
  primary button per view; the rest are `outline` or `ghost`.
- Semantic tones are reserved for meaning: `positive` (met, retained),
  `caution` (partial, to check), `negative` (missing, dismissed),
  `neutral` (not stated). Never for decoration.

## Components (src/components/app-shell)

- `PageHeader`: eyebrow (optional), title, description, actions on the
  right; on phones the actions wrap under the title.
- `Section`: a title with an optional count and action, then its content.
- `Sheet` utility: the card (`rounded-2xl border bg-card`); `sheet-row` for a
  list row (`flex items-center gap-4 py-4`), hover tint, the whole row is the
  link when it leads somewhere.
- `StatTile`: a label, a big tabular number, an optional delta or link.
- `Pill`: statuses and verdicts; always with a leading dot or icon so colour
  is never the only signal.
- `ScoreRing`: the fit score 0–100 as a ring with the number inside; green
  from 80, amber from 60, red below; "—" when no score.
- `RequirementList`: one row per requirement with the mark (✓ met, ~ partial,
  ✗ missing, ? not stated), the label, the evidence in muted text.
- `EmptyState`: an icon in a tinted disc, one sentence, one action.
- `Skeleton` rows while loading; never a spinner alone on a blank page.
- Dialog and Sheet (drawer) from `src/components/ui`, sized as above.

## Motion

150ms ease-out for hover and pressed states, 200ms for panels, nothing
bounces. Lists animate rows in once (`rise-in`), never on every refresh.

## Honesty in the interface

A value the CV does not state reads "Non renseigné" in muted text, never a
dash that could be read as "none". A model's sentence is introduced as the
model's ("Lecture du modèle"). A decision shows who took it and when.
