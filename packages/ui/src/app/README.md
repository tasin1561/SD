# `@skydrop/ui/app` — the app primitives (apps restyle, Layer B)

The premium-ui-motion component set for the four product apps (seller,
admin, reseller, track). The legacy `@skydrop/ui/components` stay untouched
until each app has moved off them (Phase 7 deletes what nothing imports).

## The contract every primitive follows

**Layout.** One folder per primitive: `src/app/<kebab-name>/index.tsx` plus
`<kebab-name>.css`, imported at the top of `index.tsx`
(`import './<kebab-name>.css';`). It is imported by path —
`import { TextField } from '@skydrop/ui/app/text-field'` — never through a
barrel, so each pattern ships only with the routes that use it. `'use client'`
only where the component needs state, effects or handlers.

**Class names.** Prefix `sk-<name>`, BEM for parts (`sk-field__label`), and
state as data attributes (`data-state="busy"`, `data-invalid`, `data-on`)
rather than modifier classes, so CSS and tests read the same fact.

**Colour: tokens only, no raw colour.** No hex, no rgb/rgba, no `color-mix`
with a literal. Read the semantic tokens from `brand/theme.css` and
`brand/app.css`:
- surfaces `--page`, `--surface`, `--surface-2` (cards), `--surface-3`
  (raised, hover), `--surface-band`, `--surface-input`, `--scrim`
- text `--fg-strong`, `--fg-body`, `--fg-muted`, `--fg-faint`; links `--sky`
- lines `--line`, `--line-strong`, `--border-control`, `--focus-ring`
- accent `--accent-fill`, `--accent-fill-hover`, `--accent-fg`,
  `--accent-tint`, `--accent-line`
- per hue (`blue saffron green teal violet magenta red`): `--{hue}-text`,
  `--{hue}-fill`, `--{hue}-fill-hover`, `--{hue}-on-fill`, `--{hue}-tint`,
  `--{hue}-on-tint`, `--{hue}-surface`, `--{hue}-line`, `--{hue}-glow`
- status `--st-{kind}-fg|bg|line` for `neutral draft pending confirmed
  in-transit delivered rto failed cancelled held`; money `--money-credit`,
  `--money-debit`
- `--corridor-gradient` for accents (the active nav row, a progress bar, a
  KPI glow). Text on it is always `--on-corridor` (slate-950) in BOTH themes —
  never white, which fails over the gold (marketing's MKT-1).
- shadows `--elev-1|2|3`; in dark prefer a `--{hue}-glow` over a shadow.

**Scale.** `--fs-2xs..--fs-kpi` (body is `--fs-md` 14px; dense cells
`--fs-sm` 13px), `--sp-1..--sp-12` (4px base), `--r-xs 4 / --r-sm 8 /
--r-md 12 / --r-lg 16 / --r-pill`, control heights `--ctl-h-sm 32 / --ctl-h 40
/ --ctl-h-lg 44`, and `--tap` (40px, 44px on coarse pointers) as the minimum
target. Fonts `--app-font` (Plus Jakarta Sans) everywhere; `--app-mono` only
for AWB, order ID, serial, SKU (class `.sk-ident`). Figures use `.sk-figure`
(tabular Plus Jakarta), never mono. Sentence case everywhere; no uppercase
tracked labels, no "01 //" eyebrows.

**Motion.** `transform` and `opacity` only (plus `stroke-dashoffset`,
`clip-path` or path `d` on SVG under 120px). Durations from `--dur-fast`
150ms, `--dur` 220ms, `--dur-slow` 350ms; easing `--ease-out`, `--ease-spring`.
JS timers go through `ms()`/`sleep()` from `../motion/motion`. Reduced motion is
handled globally (`brand/app.css` collapses every animation for the OS
preference and for `data-reduced="1"`), so a pattern needs no reduced-motion
CSS of its own — but its END STATE must be correct with no motion, and JS
sequences check `reducedMotion()` and jump to the end. Entrance animations run
once per mount, never on a re-render or refetch. Loops pause off-screen
(IntersectionObserver) and on a hidden tab. No `filter: blur` animation, no
`backdrop-filter`, `will-change` only while animating. Storytelling sequences
≤ 1.2s and never block the next action: the control is usable again (or the
next field focusable) as soon as the real result is known.

**Honesty.** A busy/success/error state is wired to the REAL request (a
promise the caller passes, or `useAsyncState`), never faked. Navigation is
never delayed by an animation. The accessible name stays stable while a
visual label morphs; results announce through `aria-live="polite"`; busy
controls carry `aria-busy` and are disabled; focus is never lost.

**Accessibility.** The right ARIA pattern (tablist, listbox/combobox, switch,
dialog with focus trap and return, menu). Visible `:focus-visible`. Colour is
never the only signal (icon or word too). Targets ≥ `--tap`. Keyboard works
for everything a pointer does.

**Dependencies.** `react`, `clsx`, `lucide-react`, `@radix-ui/react-dialog`
(already in the package) and `@skydrop/ui/status` for status kinds and words.
Nothing new. Icons from lucide-react, imported one by one.

**Size.** Aim ≤ 3 KB gzip JS and ≤ 2 KB gzip CSS per primitive (the marketing
micro budget). `node scripts/primitive-sizes.mjs` reports them.

**Gallery.** Each group adds its entries to `src/app/gallery/entries-<group>.tsx`
(a `GalleryEntry[]`, see `gallery/types.ts`) showing every state live.

**Reference.** Before building a pattern, read
`.claude/skills/premium-ui-motion/SKILL.md` and view its contact sheet in
`assets/upgrades/uNN-*.jpg` or `assets/storytelling/*.jpg`. Where apps/marketing
already has the pattern (`apps/marketing/src/components/micro/<name>`), start
from it — copy, then adapt to app density and these tokens. Never modify
apps/marketing.

## Recorded budget exceptions (owner, 2026-09-23)

`node scripts/primitive-sizes.mjs` reports these as exceptions, not failures:

- **`shell`** (≈3.4 KB JS, 2.6 KB CSS) — the app chrome, loaded once per app.
- **`sign-in-map`** (≈11.4 KB JS) — the full-detail coastline behind the
  sign-in screen. `sign-in` itself stays small; it renders `LazyCorridorMap`,
  which imports the map only after first paint when the browser is idle, so
  the form is interactive at once.
