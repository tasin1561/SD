# Skydrop Landing — Design Direction

**Direction name: MISSION CONTROL** (v2 rebuild, 2026-07)

---

## 1. Concept

Skydrop's actual product is an operations backbone: call-confirm queues,
bin-level stock ledgers, webhook tracking, NDR routing. Every competitor
landing page hides that machinery behind stock photos of smiling couriers.
We do the opposite: **the landing page IS the ops console.**

The visitor lands inside Skydrop's mission control for the BD → IN corridor.
Parcels are tracked flights. Lifecycle events tick across a live telemetry
feed. Sections read like instrument panels, not brochure cards. The page
doesn't *claim* precision — it *performs* it.

Reference points: air-traffic-control displays, Linear's restraint,
Vercel's data-dark surfaces, flight-radar aesthetics. NOT cyberpunk — no
glitch, no neon magenta, no scanline kitsch. This is a calm, confident
instrument. The drama comes from motion discipline and data texture, not
decoration.

Why this direction wins for this audience: BD sellers evaluating Skydrop
are placing trust in an *operation* they cannot see. A page that behaves
like a precision instrument transfers exactly that trust. It is also
unfakeable by competitors whose landing pages are template-built.

## 2. Brand anchors honored (CLAUDE.md constraints)

- **Sky-blue core accent** → sky #38BDF8 is the phosphor of every
  instrument: route lines, live blips, CTAs, focus rings.
- **Dark-leaning** → default theme is NIGHT OPS (near-black blue). A DAY
  OPS light variant (blueprint on paper) stays fully supported via the
  existing token system + toggle.
- **Logistics/precision personality** → monospace telemetry, corridor
  cartography, event codes, tabular numerals.

## 3. Tokens

### Palette — NIGHT OPS (default)

| Token | Value | Role |
|---|---|---|
| `--surface` | `#060B16` | page — deep space blue, darker than old ink |
| `--surface-2` | `#0C1424` | panels / cards |
| `--surface-3` | `rgba(56,189,248,0.05)` | hover fills, faint panel tint |
| `--fg-strong` | `#F3F7FC` | headings |
| `--fg-body` | `#C3D0E0` | body copy (AAA on surface) |
| `--fg-muted` | `#8296AE` | captions, labels |
| `--sky` | `#38BDF8` | THE accent — phosphor |
| `--sky-deep` | `#0284C7` | hover / links on light |
| `--saffron` | `#F59E0B` | India endpoint, alerts — max 1 per viewport |
| `--green` | `#34D399` | confirmed / delivered states only |
| `--line` | `rgba(148,178,255,0.10)` | hairline borders |
| `--grid` | `rgba(56,189,248,0.05)` | background graph grid |

### Palette — DAY OPS (light variant)

Paper `#F6F8FB`, panels white, ink text `#0B1523`, body `#31435A`,
grid lines `rgba(2,132,199,0.08)` — reads as a blueprint of the same
console. Same accent hierarchy.

### Typography

| Slot | Font | Why |
|---|---|---|
| Display / headings | **Space Grotesk** 500–700 | geometric, technical character; more voice than Instrument Sans |
| Body / UI | **Inter** 400–500 | legibility workhorse |
| Telemetry / data | **JetBrains Mono** 400–500 | event codes, AWBs, stats, section indices |

Scale: display `clamp(2.5rem, 6vw, 4.5rem)`, h2 `clamp(1.9rem, 3.6vw, 2.9rem)`,
body 16–17px, telemetry 11–13px uppercase tracked +0.08em.

### Shape & space

- Panels: 12px radius, 1px `--line` border, NO drop shadows on dark —
  elevation comes from surface steps + hairlines. Light mode may use
  1-step shadows.
- Corner ticks (`+`) at panel corners on key surfaces — cartographic
  signature detail, CSS-only.
- Section rhythm: `py-20 lg:py-28`; content max 1200px; section headers
  carry a mono index (`SEC 01 / PROBLEM`) — consistent instrument chrome.

## 4. Motion philosophy — "COMING ONLINE"

Elements don't fade in — they **power on**. The system reads as live.

1. **Boot reveal**: opacity 0.4→1 + y 8→0, 220ms, ease-out. Tight, never
   floaty. Stagger 60ms.
2. **Telemetry tick**: mono text elements (event feed, counters) update
   with an instant swap + 120ms sky flash — data, not animation.
3. **Draw**: route lines and progress rails draw via `pathLength` /
   `scaleX` when scrolled into view. 900–1400ms, once.
4. **The page never blocks**: all motion is transform/opacity, SSR HTML
   is fully visible (no opacity-0 initial states — learned from v1),
   `prefers-reduced-motion` collapses everything to static instantly.

## 5. Signature moment

**The Corridor Console (hero).** A full-width, hand-built `<canvas>`
scene: a stylized long-range map of the BD → IN corridor drawn in
phosphor lines — Dhaka origin node, Indian destination cities (DEL, BLR,
BOM, CCU) — with parcel blips flying the arcs in real time, each leaving
a fading trail. A radial scan sweep passes every ~8s. Under it, a **live
telemetry strip** ticks through true lifecycle events (`CALL CONFIRMED`,
`PICKED BLR-01/A3`, `DISPATCHED DLV`, `DELIVERED`), timestamped, endless.

Hand-built canvas 2D, ~6KB of code, zero libraries — chosen over React
Three Fiber deliberately: R3F + three costs ~150KB gzip for a look we can
outdo with cartography that matches the brand exactly. DPR-aware, paused
when tab hidden, replaced by a static SVG frame under reduced-motion.

## 6. Section map

| # | Section | Treatment |
|---|---|---|
| 0 | Nav | console top bar: wordmark + `SYS ONLINE` status, links, theme toggle, CTA |
| 1 | Hero | Corridor Console canvas + headline + CTAs + telemetry ticker |
| 2 | Problem | **Diagnostics panel** — 6 failure modes as fault cards with mono codes (`FAULT 01 — WAREHOUSE`) |
| 3 | How it works | **Flight plan** — 4 phases on a drawing corridor rail, mono phase indices |
| 4 | Why Skydrop | Bento: large call-confirm cell w/ simulated call-log feed + RTO counters; 5 instrument cells |
| 5 | Comparison | **Manifest table** — Skydrop column phosphor-tinted |
| 6 | Track | Console prompt: `> TRACK` + AWB input |
| 7 | FAQ | Accordion with mono indices (`Q.01`) |
| 8 | Final CTA | "Request clearance" moment — centered, glow, invite CTA |
| 9 | Footer | Status-bar footer: capability chips as system readouts |

## 7. Performance contract

- First-load JS **< 170KB** gzip (no three.js; canvas is hand-rolled)
- Lighthouse mobile ≥ 90 all categories
- Canvas: capped DPR (≤2), rAF paused off-screen + tab-hidden,
  zero canvas under reduced-motion
- Fonts: 3 families via next/font, latin subset, swap
- Static export (`output: 'export'`) unchanged — Caddy serves /out

## 8. Anti-patterns being explicitly avoided

- Generic SaaS card grids with icon-title-blurb ×6 (v1's weakness)
- Cyberpunk kitsch: glitch, neon magenta, scanlines
- opacity-0 SSR states that blank the page pre-hydration (v1 bug)
- Decorative-only animation; anything > 400ms except line draws
- Accent soup — sky is the voice; saffron whispers once per viewport
