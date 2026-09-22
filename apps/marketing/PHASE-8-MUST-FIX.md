# Phase 8 — must-fix list (performance pass)

Owner's rule (2026-09-21): regressions found mid-build are recorded here with what was
measured and what was traced, and closed in Phase 8 against Lighthouse mobile (Slow 4G,
4× CPU) on the home page. Baseline at the end of Phase 3: perf 97, LCP 2.3 s, CLS 0,
TBT 140 ms.

## 1. CLS 0.064 after Phase 3.5 — header grew when the deferred stylesheet landed

**Measured:** CLS 0.064 on `<main>` in every throttled run (4 of 4 with `swap`, 3 of 3
with `optional` — so not the font). Traced with a per-frame sampler: at 1440 the header
sat at y=34 under the inlined critical CSS and moved to y=64 when the deferred sheet
applied (~400 ms later), pushing `<main>` down 30 px; at 412 the strip above the header
went 59 → 27 px.

**Root cause (FOUND, FIXED in `8352a5cd`):** `scripts/critical-css.mjs` stripped `:flex`
from `.lg\:flex` as a pseudo-class and `[12px]` from `.text-\[12px\]` as an attribute
selector, so EVERY responsive / arbitrary-value utility above the fold was dropped from
the critical sheet. The header rendered mobile-shaped (utility bar hidden, nav hidden,
track field hidden) until the full sheet arrived. Escapes are now held as placeholders
through the strippers. The theme switch (placeholder until hydration) has its
stylesheet's classes added to the fold set; the fold now ends at `</footer>` and only
keyframes a kept rule animates are kept.

**Owner's rule to keep:** all header / utility-bar / hero CSS belongs in the inlined
critical set, never in the deferred sheet. **Phase 8 check:** `critical-diff2.cjs`-style
diff (critical-only vs full CSS, hydrated, at 412 and 1440) must show NO differences
above the fold. After the fix the residual CLS was 0 / 0.015 / 0.015, the 0.015 from an
old section's island (deleted in Phase 4) — re-measure and confirm 0.

## 2. TBT 330–910 ms after Phase 3.5 (was 140 ms); 750–850 ms after Phase 5; 360–380 ms after Phase 6 (contact island near-gated)

**Measured:** TBT 330 / 440 / 550 / 620 / 840 / 910 ms across runs on the same build
(noisy on this machine; the 2530 ms run coincided with load). Lighthouse's breakdown:
Style & Layout ~1.5 s, Script Evaluation ~1.4 s (4× throttled); long tasks of 297 ms and
199 ms attributed to the document (inline flight data + the deferred-sheet restyle),
271 ms in `main-app`, 198 ms in the React chunk, 145 ms in the page chunk. The first-load
JS is 147.5 KB gz after Phase 4 (138.4 at Phase 3), so bytes are not the story;
hydration work is.

**Phase 5 (2026-09-21):** with the tour and reseller islands hydrating eagerly TBT read 1,010 / 1,350 ms; gating their chunk fetch on near-viewport (`lib/near-gate.ts`) brought it to 750 / 850 ms. What remains is the FIRST-LOAD hydration (153 KB gz of JS on the page) plus the deferred-sheet restyle.

**Suspects (not yet isolated):** the deferred stylesheet's full restyle of a 1,600-node
page; `useLayoutEffect` measurements at hydration (`HeaderNav` pill, `LiquidBead` bead,
`Odometer`); the `CorridorConsole` canvas base render (already deferred to idle); the
header drawer's rows and the toast host hydrating in the first task.

**Phase 8 plan:** take a CDP performance trace (not Lighthouse's summary) and attribute
each long task to an island; defer every island that is not in the first viewport to
`requestIdleCallback` / near-viewport (`dynamic()` + IntersectionObserver, as the
estimator already is); replace hydration-time `useLayoutEffect` measurements with a
CSS-only initial state where possible; measure TBT three times and report the median.
Target: back at or under 200 ms.

## 3. Shipped micro-library total 50.2 KB gz vs the owner's 40 KB gate (53.4 KB after Phase 7) — CLOSED: owner accepted 54 KB (2026-09-22)

**Phase 7:** the reactive mascot (pattern 13, 1.5 KB) joined the contact form and took the total to 53.4 KB; the gate moved to 54 KB provisionally. It ships only in the near-gated contact chunk, so first-load is untouched (154.9 KB).

Phase 4 ships 29 patterns at ~1.7 KB average, each inside its 3 KB / 2 KB budget. The
gate in `scripts/check-micro-size.mjs` was raised PROVISIONALLY to 52 KB so the build
stays green. **Owner (Phase 4 review):** move CSS-only patterns out of JS, dedupe shared
keyframes, and make sure each pattern ships only with the island that uses it. If it
genuinely cannot fit 40 KB, report the number and what the extra 10 KB buys.

## 4. LCP 2.7–3.0 s at the end of Phase 4, 3.0–3.2 s after Phase 6 (2.3 s at Phase 3) — OWNER TARGET ≤ 2.0 s

**Measured:** three runs 2.8 / 2.9 / 2.9 s, LCP element still `p.hero__sub`, FCP
1.4–1.8 s. The page grew: index.html 44 → 54 KB gz, critical CSS 12.5 → 14.2 KB gz,
first-load JS 138 → 148 KB gz, and the estimator's islands hydrate in the same window.
**Phase 8 plan:** measure the LCP phases (TTFB / load delay / render delay) from the
trace; trim the critical sheet (the `[data-hue]` blocks are now per-hue; the mega-menu
and drawer CSS could move to their own deferred chunk); defer below-fold islands as in
item 2; re-check the HTML-weight gate. **Owner (Phase 4 review): target ≤ 2.0 s on the home page, and report the CAUSE of what grew (HTML weight, critical CSS, hydration before first paint), not just the fix.**

## 5. Font swap costs ~0.01 CLS at 1440

With `display: swap` and the metric-matched Arial fallback, the hero subtitle still wraps
one line differently between the fallback and Plus Jakarta Sans at 1440 (`div.hero-card`
moved up 26 px at ~1.4 s, v=0.010). Acceptable against the owner's rule (swap over
optional); Phase 8 may pin `.hero__sub`'s line count with a `text-wrap: balance` +
`min-height` pair if the residual matters.

## 6. `out/index.html` 83.0 KB gz after Phase 6 — the owner's gate is 75 KB (provisionally 88 KB) — CLOSED: owner accepted 88 KB (2026-09-22)

**Measured (Phase 6 build):** 528 KB raw / 83.0 KB gz, up from 66.9 KB at the end of the
Phase 4 fix pass. Breakdown: DOM 39.4 KB gz · the RSC flight payload
(`self.__next_f.push`) 31.5 KB gz · inline critical CSS 12.1 KB gz · FAQ JSON-LD ~2.5 KB gz.
The three new sections weigh FAQ 5.0 / contact 2.4 / final CTA 0.95 KB gz in the DOM, and
each server section lands TWICE (DOM + flight — the flight copy sits >200 KB later in the
file, outside gzip's 32 KB window, so nothing deduplicates), plus the FAQ text a third time
in the JSON-LD.

**Cause of growth:** structural to App Router static export (every server-rendered byte is
duplicated in the flight payload), multiplied by three text-heavy sections. Heaviest DOM
sections: coverage 5.9 KB (the desktop 2.5D map is inline), FAQ 5.0 KB.

**Options for Phase 8, owner's call:** (a) accept and set the gate to 85 KB — the flight
duplicate alone is 37% of the file and cannot be removed without leaving the App Router;
(b) trim the FAQ to ~10 Q&As (≈ −5 KB gz across its three copies); (c) move the coverage
map's SVG into the near-gated island so it leaves the HTML (≈ −5 KB gz, desktop only, at the
cost of the map arriving with the chunk). The gate in `scripts/check-bundle.mjs` is raised
to 88 000 provisionally so CI stays green; the owner's 75 000 is recorded there.

## Phase 8 pass — what was measured and what moved (2026-09-22)

Lighthouse mobile (Slow 4G, 4× CPU) on the home page, before → after, two runs each:
perf 78–83 → **86–93** · FCP 1.7 → **1.2–1.4 s** · LCP 3.0–3.3 → **2.6–2.7 s** · CLS 0 → **0**
(0.066 mid-pass, see below) · TBT 550–660 → **190–420 ms** (noisy on this machine) · a11y /
bp / seo 100. First-load JS 154.9 → **146.5 KB gz**; `out/index.html` 83.8 → **79.3 KB gz**;
the sans font fetched once; the mono font no longer downloaded at all (−40 KB on every visit).

Deterministic companion measure (Playwright, Slow 4G + 4× CPU, 412×823, three runs): first paint
0.58–0.86 s, hydration complete 2.7–3.2 s, long-task excess after FCP 0.52–0.87 s, **longest
task 243–295 ms (was 650–726)**.

**What moved it, in order of effect:**

1. **`content-visibility: auto` on every `.sec`** (the hero is `.hero`). A CPU profile showed
   JavaScript at ~1 s of a 7 s window; the 700 ms task after the stylesheets landed was the
   browser restyling and laying out all ~500 KB of HTML. Off-screen sections are now skipped
   until they approach. `contain-intrinsic-size: auto 50rem` keeps the last measured height.
2. **Six more islands near-gated** (services, coverage, how-it-works, track band, goods,
   testimonials) — server-rendered, chunk fetched and hydrated when near. Every loader carries a
   `loading` fallback, which is load-bearing: without one next/dynamic gives an SSR'd component
   NO Suspense boundary and the pending gate suspends the page segment — nothing hydrates, no
   error anywhere (found by `theme.spec` + `hero-fit.spec` going red together in Phase 6).
3. **The seven island stylesheets (`data-precedence="dynamic"`, `href` first) were
   render-blocking** — the critical-CSS script only matched `rel` before `href`. Converted like
   the rest; Next's low-priority `<link rel="preload" as="script">` hints for the ten lazy chunks
   (~60 KB) are stripped, since the near-gate's `import()` is what should fetch them.
4. **The mono font.** Tailwind's preflight styles bare `<code>` with `--font-mono`, so the
   `<code>` in the platform mocks pulled JetBrains's 40 KB file; and an `<input>` loads its font
   for its own metrics even when empty, so the empty PIN boxes and the waybill field did too.
   Bare code gets the system mono (`--default-mono-font-family`); the fields take the mono face
   only once they hold a value (`data-filled`, `:not(:placeholder-shown)`).
5. **The coverage map** is drawn after mount, so its ~6 KB gz of SVG is in neither the HTML nor
   the flight payload (it was desktop-only and below the fold anyway).
6. **The local harness lied about fonts**: `serve-static.mjs` sent `no-store` for everything, so
   the sans font downloaded twice (preload + the stylesheet's @font-face) in every local run.
   Hashed `/_next/static/` assets are now `immutable`, as Caddy serves them in production.

**CLS 0.066 mid-pass — a mechanism worth remembering.** Once first paint happened before the
deferred sheets, the FAQ's eight category tabs (774 px of `inline-flex nowrap`, styled by the
liquid-bead rules the hero also uses) sat in a container whose `overflow-x: auto` was deferred.
The document was wider than the screen, so Chrome's MOBILE layout viewport grew to fit it
(412 → 790 px, 823 → 1579 px), the fixed bottom bar sat at the bottom of the 1579 px viewport,
and it jumped 750 px when the sheet landed. `overflow-x: clip` on the root does NOT prevent
this. The critical-CSS script now runs a **containment pass**: `overflow*` declarations for
every class present anywhere in the page, not only the fold — a few hundred bytes. Verified by
loading with every `.css` request blocked: the viewport stays 412 px.

**Stylesheet flip A/B** (single flip of all eleven once the last arrived vs. per-link `onload`):
the same long-task total; the per-link shape keeps the longest task 243–295 ms against 304–330
and needs no inline script, so it stays. A single CONCATENATED deferred sheet was tried and
reverted: React Float looks for the page's own stylesheet hrefs at hydration and re-inserted all
four (30 KB re-downloaded, hydration held until they landed).

**Item 4, LCP — where the remaining 0.6 s is, and why it is not the font.** A Lighthouse run with
every `.woff2` blocked still reports LCP 2.6 s (FCP 1.4), so `font-display: optional` would not
have helped. The observed paint in Lighthouse's own trace is 208 ms (FCP = LCP); the 2.6 s is
Lantern's simulation, whose pessimistic LCP graph counts every request started before the paint
— the React runtime and page chunks (146 KB gz) requested at ~90 ms. Under a real Slow 4G + 4×
CPU emulation the hero paints at 0.58–0.86 s. **To move the simulated figure further, the
levers left are fewer first-load JS bytes (the App Router runtime is 103 KB of the 146) and a
smaller HTML document (the RSC flight payload is 31 KB gz of the 79).** Neither is a Phase 8
change; the owner decides whether 2.6 s in the simulation, against 0.6–0.9 s on an emulated
device, is accepted.

**Not done, and why:** subsetting the mono font (40 KB → ~6 KB for digits + uppercase) needs
`fonttools`, which is not installed here and is not installed without approval; it no longer
loads on the home page, so the win would be on the waybill fields when typing.

## Final pass — the owner's bounded LCP experiment (2026-09-22, ≤ 45 min)

**Question asked:** is the LCP candidate the hero text's SECOND render, when Plus Jakarta
arrives? **No.** Under a real Slow 4G + 4× CPU emulation the `largest-contentful-paint`
observer reports exactly ONE candidate for `p.hero__sub`, at first paint (0.58–0.86 s); the
swap to the web font does not emit a second entry, because the metric-matched fallback keeps
the box the same size. Lighthouse's own trace paints it at 208 ms.

**Experiment run anyway:** the sans preload at `fetchpriority="high"` as the first request
after the HTML, and every async script at `fetchpriority="low"`. Two runs each on the same
build: baseline LCP **2.3 / 2.3 s** (FCP 1.3 / 1.2, TBT 770 / 510); experiment LCP **2.4 /
2.8 s** (FCP 1.7 / 1.3, TBT 2,310 / 910). Worse on every metric — starving the runtime
pushes hydration out and the simulation's LCP with it. **Reverted; the flag is gone from the
script.** The remaining gap to 2.0 s is the simulated cost of the first-load JS requested
before the paint (see Phase 8 above); 2.3 s is accepted.

The font-subset half (a ~10 KB wght-700 latin subset for the h1) was not attempted: it needs
`fonttools`, which is not installed here and is not installed without approval, and the
measurement above says the font is not on the LCP path.
