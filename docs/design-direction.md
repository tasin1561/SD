# Skydrop Landing — Design Direction

**Direction name: COURIER** (v3 rebuild, 2026-09)

Supersedes MISSION CONTROL (v2, 2026-07) and PRECISION LOGISTICS
(2026-09-20), both rejected by the owner: they read as a developer tool.
The plan behind this document: `~/.claude/plans/silly-bouncing-cloud.md`.

---

## 1. Concept

Skydrop is a **courier and fulfilment company** for the Bangladesh ⇄ India
corridor, and the site reads as one: within three seconds a visitor knows
what this is and can **track, quote or book**; further down a seller sees
*every* shipped feature, shown rather than listed; colourful, dimensional,
and fast on a mid-range Android on BD 4G.

Reference points (studied 2026-09-21, `apps/marketing/scripts/screenshots/
reference/STUDY.md`): Delhivery's track-as-a-card hero, Pathao's floating
KPI card and rate table, Shiprocket's colour-per-product-family, CarryBee's
contact tiles. Not adopted from any of them: hero carousels, photo LCPs,
scrolling tickers, three header CTAs, track below the fold.

## 2. Brand anchors honored (CLAUDE.md constraints)

- **Sky-blue core accent** → brand blue `#2563eb` (600) is the ONLY fill
  a primary CTA ever has; `--sky` (`#004ac6` light / `#b4c5ff` dark) is
  the link colour.
- **Dark-leaning** → dark is the default theme; light is a full sibling.
- **Logistics/precision personality** → carried by the 3D corridor scene,
  tabular figures and the isometric art — not by mono eyebrows or event
  codes.

## 3. Tokens

### Colour — a meaning per hue

Raw scales (50–950, eight hues) live in `apps/marketing/src/app/scales.css`,
theme-invariant and declared once. `theme.css` chooses a step per ROLE and
per THEME, in four blocks (light ×2, dark ×2, byte-identical pairs) that
`scripts/check-theme.mjs` verifies on every build:

| token | light | dark |
|---|---|---|
| `--{hue}-text` | 700 (saffron, green, teal, magenta, red) · 600 (blue, violet) | 400 |
| `--{hue}-fill` + `-on-fill` | blue 600 + white (primary) · green/teal/magenta/red 700 + white · violet 600 + white · **saffron 400 + slate-950** — never a brown carrying white | same |
| `--{hue}-tint` + `-on-tint` | 50 + 700 (magenta: 800) | 950 + 400 |
| `--{hue}-line` | 200 | 800 |
| `--{hue}-glow` | 500 @ 12 % | 400 @ 28 % |

| meaning | hue |
|---|---|
| Brand · primary action · Team | blue |
| Send to India · Orders · warning (always with an icon) | saffron |
| Send to Bangladesh · delivered · Money | green |
| Import · Stock-in | teal |
| Export · Catalogue · the store side of Reseller stores | violet |
| E-commerce sellers · Returns | magenta (pink to 700, **plum from 800** so the dark tint never reads as red) |
| Danger only (always with an icon) | red |

**Principle:** colour comes from surfaces, tints, illustrations, icons,
gradients and the 3D scene. Body and heading text stay neutral;
accent-coloured text is for small labels, links and chips only.

**Corridor gradient** — `--corridor-gradient: linear-gradient(90deg,
green-500, saffron-400 60%, saffron-500)`, decorative only (arcs, the
scroll-progress line, highlights; white text bottoms out at 1.67:1 over
the gold). `--corridor-gradient-strong` (green-700 → saffron-700, white
≥ 5.02:1 everywhere) is for bands that carry white text.

### Typography

| Slot | Font | Why |
|---|---|---|
| Headings AND body | **Plus Jakarta Sans** (variable, latin, 27 KB) — PROVISIONAL; Manrope (25 KB) is the other candidate | one family, geometric with soft terminals, strong numerals; headings follow `--font-sans`, never a face by name |
| Identifiers / figures | **JetBrains Mono** | waybills, serials, SKUs only; `preload: false` |

Fonts are COMMITTED (`next/font/local`), never fetched at build. The
odometer and every stat use the `tabular` utility.

### Shape & space

- Radius scale 2 / 4 / 6 / 8 px; cards carry a hairline, shadows only in
  light and only one step.
- Section rhythm alternates colour-rich (hero, services, coverage, platform,
  resellers, final CTA) with calm neutral (partners, how-it-works, compare,
  FAQ, contact). Body copy always on `--surface`/`--surface-2` at AA.
- Mobile order in the hero at ≤ 430 px: headline → action card → trust row,
  all above the fold at 360 × 780.

## 4. Motion philosophy

Micro-interactions from the owner's reference clips
(`reference/motion/NOTES.md`, gitignored): parachute progress for the
quote and as the general loading motif; van drive-off for the ONE real
in-page submit (the invite form); segmented code → link-and-merge for the
serviceability checker; liquid bead for every tablist; rolling-label
buttons; the radial contact fan. Every one has a reduced-motion answer
that is the finished state, not a faster version. A success state never
plays before the real result (`useAsyncState`: min busy 600 ms, never
before the response). Navigations fire at once — no delayed motion on a
link.

## 5. Signature moment

**The corridor scene (hero)** — poster-first. The LCP is a 1440-wide AVIF
poster rendered from the scene itself (2× and downsampled with sharp);
the R3F scene is a LAZY chunk (≤ 220 KB gz) mounted only after the page
is complete, idle, the hero is on screen and `canRender3D()` passes
(reduced motion, save-data, slow network, low memory/cores, WebGL caveat
all keep the poster). Signature, stated so it cannot be trimmed: extruded
Bangladesh + India on a tilted plate · corridor-gradient arcs Dhaka →
Indian metros · a cargo plane on the arc · **parcels descending under
parachutes onto pins** · a van at the destination · gentle pointer
parallax. DPR clamped to [1, 1.5]; an FPS governor drops to the poster.

This REVERSES v2's rejection of R3F: the first-load budget (< 170 KB)
excludes the lazy 3D chunk, and the poster is what the visitor sees first
on every device.

## 6. Section map

26 sections (spec §3): utility bar · header · hero with the action card
(Track · Quote · Book) · trust row · services showcase (four scenes, one
component) · coverage · how it works · platform tour (six vignettes) ·
reseller stores · pricing/estimator · serviceability · partners · compare
· testimonials · FAQ (server `<details>`, tiny tabs island) · contact ·
final CTA (strong gradient) · footer · mobile bottom bar · floating
contact. Content lives in `src/content/site.ts`; every business figure is
a `dummy()` until the owner supplies it (`pnpm check:content` lists them).

## 7. Performance contract

Enforced by `scripts/check-bundle.mjs` in `postbuild`:

- first-load JS ≤ 170 KB gz per page; three.js never in first load, lazy
  total ≤ 220 KB gz; platform + reseller islands ≤ 60 KB gz, each vignette
  ≤ 5 KB gz
- `out/index.html` ≤ 70 KB gz; inline SVG (above the fold only) ≤ 700 KB
  raw total, ≤ 25 KB each; below-fold art via `public/art/sprite.svg`
- the sans woff2 ≤ 35 KB; poster ≤ 60 KB; above-the-fold transfer ≤ 350 KB
- Lighthouse mobile ≥ 90 all categories, LCP < 2.0 s on Slow 4G, CLS < 0.05
  — measured locally with the CLI (CI runs no network tooling)
- Static export unchanged — Caddy serves `out/`

## 8. Anti-patterns being explicitly avoided

- Developer-tool chrome: `SEC NN //` eyebrows, event tickers, terminal logs
- Text on the decorative gradient; a warning or danger state with no icon
- A darkened saffron carrying white text
- A component picking a raw colour step instead of a semantic token
- A fake success state (newsletter is off until it has an endpoint)
- Photo LCPs, hero carousels, more than one filled CTA in the header
