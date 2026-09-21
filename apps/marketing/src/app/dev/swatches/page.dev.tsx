import { Check, OctagonX, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import {
  CORRIDOR,
  CORRIDOR_STOPS,
  HUES,
  PAGE,
  STEPS,
  contrast,
  grade,
  gradientMin,
  sampleGradient,
  type HueScale,
} from './palette';

/**
 * Swatch + specimen page — a DEV ROUTE (`page.dev.tsx`; compiled only with
 * MARKETING_DEV_ROUTES=1, so a plain `next build` never sees it).
 *
 * Phase 1 revision (owner findings A–C + token rules 1–5):
 *   A. specimens set `--font-sans-face` on the CARD, so h1/h2 — which follow
 *      `--font-sans` — really render in the candidate (they were Plex before:
 *      a global rule pinned headings to that face by name);
 *   B. ONE corridor gradient ships (the golden three-stop sRGB), shown once
 *      beside the same stops `in oklch` for comparison, plus the STRONG one
 *      for bands that carry white text, with the contrast numbers;
 *   C. magenta's dark tint is PLUM, shown as two large panels beside red.
 */

export const metadata: Metadata = {
  title: 'Swatches — Phase 1 (dev)',
  robots: { index: false, follow: false },
};

// The unicode-range literal is repeated per call: next/font reads literals
// only — a shared const fails the BUILD (proven in Phase 0).
const jakarta = localFont({
  src: '../../fonts/plus-jakarta-sans-latin.woff2',
  variable: '--font-cand-jakarta',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});
const manrope = localFont({
  src: '../../fonts/candidates/manrope-latin.woff2',
  variable: '--font-cand-manrope',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const FONT_BUDGET = 35_000;

interface Candidate {
  id: string;
  name: string;
  status: 'provisional' | 'candidate';
  variableClass: string;
  cssVar: string;
  file: string;
  note: string;
}

const CANDIDATES: readonly Candidate[] = [
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    status: 'provisional',
    variableClass: jakarta.variable,
    cssVar: '--font-cand-jakarta',
    file: 'plus-jakarta-sans-latin.woff2',
    note: 'PROVISIONAL family (one token + one file). Geometric with soft terminals; strong numerals. wght 200–800.',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    status: 'candidate',
    variableClass: manrope.variable,
    cssVar: '--font-cand-manrope',
    file: 'candidates/manrope-latin.woff2',
    note: 'Geometric grotesque, slightly wide, calm; the most even body texture. wght 200–800.',
  },
];

function fileSize(name: string): number {
  try {
    return statSync(join(process.cwd(), 'src/app/fonts', name)).size;
  } catch {
    return 0;
  }
}
const kb = (b: number): string => `${(b / 1024).toFixed(1)} KB`;

// ── Pieces ─────────────────────────────────────────────────────────────

function Ratio({ fg, bg }: { fg: string; bg: string }): ReactElement {
  const r = contrast(fg, bg);
  const g = grade(r);
  return (
    <span className="tabular font-mono text-[11px]" data-grade={g} title={`${fg} on ${bg}`}>
      {r.toFixed(1)}
      <span className="text-fg-faint"> {g === 'AA' ? '✓' : g === 'AA-large' ? '~' : '✗'}</span>
    </span>
  );
}

/** Which step each ROLE uses per theme — the same rules theme.css encodes. */
const TEXT_LIGHT: Record<string, 600 | 700> = {
  blue: 600,
  violet: 600,
  saffron: 700,
  green: 700,
  teal: 700,
  magenta: 700,
  red: 700,
};
const ON_TINT_LIGHT: Record<string, 700 | 800> = { magenta: 800 };
const FILL: Record<string, { step: 400 | 600 | 700; on: string }> = {
  blue: { step: 600, on: '#ffffff' },
  violet: { step: 600, on: '#ffffff' },
  green: { step: 700, on: '#ffffff' },
  teal: { step: 700, on: '#ffffff' },
  magenta: { step: 700, on: '#ffffff' },
  red: { step: 700, on: '#ffffff' },
  saffron: { step: 400, on: '#020617' },
};

function ScaleRow({ hue }: { hue: HueScale }): ReactElement {
  const tl = TEXT_LIGHT[hue.id] ?? 600;
  const lightText = hue.scale[tl];
  const darkText = hue.scale[400];
  const fill = FILL[hue.id];
  return (
    <section className="rounded-md border border-line bg-surface-2 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-fg-strong">
          {hue.name}
          <span className="ml-2 text-sm font-normal text-fg-muted">{hue.meaning}</span>
        </h3>
        {hue.id === 'slate' ? null : (
          <p className="text-xs text-fg-muted">
            text on light ({tl}): <Ratio fg={lightText} bg={PAGE.light} /> · text on dark (400):{' '}
            <Ratio fg={darkText} bg={PAGE.dark} /> · large-text 600 on light:{' '}
            <Ratio fg={hue.scale[600]} bg={PAGE.light} />
            {fill ? (
              <>
                {' '}
                · fill {fill.step} + {fill.on === '#ffffff' ? 'white' : 'slate-950'}:{' '}
                <Ratio fg={fill.on} bg={hue.scale[fill.step]} />
              </>
            ) : null}
          </p>
        )}
      </header>
      <ol className="grid grid-cols-6 gap-1 sm:grid-cols-11">
        {STEPS.map((step) => {
          const hex = hue.scale[step];
          const isL = hue.id !== 'slate' && step === tl;
          const isD = hue.id !== 'slate' && step === 400;
          return (
            <li key={step} className="flex flex-col gap-1">
              <div
                className="h-12 rounded-sm"
                style={{
                  background: hex,
                  outline: isL || isD ? '2px solid var(--fg-strong)' : undefined,
                  outlineOffset: 1,
                }}
                title={hex}
              />
              <div className="font-mono text-[10px] leading-tight text-fg-muted">
                <div className="text-fg-body">
                  {step}
                  {isL ? ' L' : ''}
                  {isD ? ' D' : ''}
                </div>
                <div>{hex}</div>
                <div>
                  L <Ratio fg={hex} bg={PAGE.light} />
                </div>
                <div>
                  D <Ratio fg={hex} bg={PAGE.dark} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A chip drawn with the SEMANTIC tokens — exactly what a component will use. */
function TokenChip({
  hue,
  label,
  icon,
}: {
  hue: string;
  label: string;
  icon?: ReactNode;
}): ReactElement {
  const h = HUES.find((x) => x.id === hue);
  const onL = ON_TINT_LIGHT[hue] ?? 700;
  return (
    <div className="flex flex-col gap-1">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium"
        style={{
          background: `var(--${hue}-tint)`,
          color: `var(--${hue}-on-tint)`,
          borderColor: `var(--${hue}-line)`,
        }}
      >
        {icon}
        {label}
      </span>
      {h ? (
        <span className="text-[11px] text-fg-muted">
          light {onL}/50: <Ratio fg={h.scale[onL]} bg={h.scale[50]} /> · dark 400/950:{' '}
          <Ratio fg={h.scale[400]} bg={h.scale[950]} />
        </span>
      ) : null}
    </div>
  );
}

function GradientBar({
  css,
  label,
  note,
  children,
}: {
  css: string;
  label: string;
  note: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex h-12 items-center justify-center rounded-md" style={{ background: css }}>
        {children}
      </div>
      <figcaption className="text-xs text-fg-muted">
        <span className="font-semibold text-fg-body">{label}</span> — {note}
        <code className="mt-1 block break-all font-mono text-[10px] text-fg-faint">{css}</code>
      </figcaption>
    </figure>
  );
}

function Specimen({ c }: { c: Candidate }): ReactElement {
  const size = fileSize(c.file);
  const within = size <= FONT_BUDGET;
  // The candidate becomes `--font-sans-face` on THIS card, so h1/h2 (which
  // follow `--font-sans`) really render in it. Finding A.
  // …and the card sets its own font-family from that variable, because a
  // <p> inherits font-family from `body` (which declares one), not from a
  // card that only declares a variable.
  const style = {
    '--font-sans-face': `var(${c.cssVar})`,
    fontFamily: 'var(--font-sans-face), ui-sans-serif, system-ui, sans-serif',
  } as CSSProperties;
  return (
    <section
      data-specimen={c.id}
      className={`${c.variableClass} rounded-md border border-line bg-surface-2 p-5`}
      style={style}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <h3 className="text-lg font-semibold text-fg-strong">
          {c.name}
          <span
            className="ml-2 rounded-sm px-1.5 py-0.5 text-[11px] font-medium"
            style={{
              background: c.status === 'provisional' ? 'var(--blue-tint)' : 'var(--surface-3)',
              color: c.status === 'provisional' ? 'var(--blue-on-tint)' : 'var(--fg-muted)',
            }}
          >
            {c.status}
          </span>
        </h3>
        <p className="tabular font-mono text-xs text-fg-muted">
          {c.file.replace('candidates/', '')} · {kb(size)}{' '}
          <span style={{ color: within ? 'var(--green-text)' : 'var(--red-text)' }}>
            {within ? '≤ 35 KB ✓' : '> 35 KB ✗'}
          </span>
        </p>
      </header>
      <p className="mb-4 text-sm text-fg-muted">{c.note}</p>

      <h1 className="text-[clamp(2rem,4.5vw,3.25rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg-strong">
        Sell in India. We carry the rest.
      </h1>
      <h2 className="mt-3 text-[clamp(1.375rem,2.5vw,1.875rem)] font-semibold leading-tight tracking-[-0.01em] text-fg-strong">
        Every order confirmed by phone before it ships
      </h2>
      <p className="mt-3 max-w-[62ch] text-base leading-relaxed text-fg-body">
        Your stock waits in our Indian warehouse. When a customer orders, our call centre confirms
        it, the warehouse picks and packs, and the courier collects the same day. You see the
        parcel, the call and the money in one place — 0123456789 ৳ ₹.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-fill px-5 text-sm font-semibold text-blue-on-fill"
        >
          Get a quote
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-control px-5 text-sm font-semibold text-fg-strong"
        >
          Track a parcel
        </button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        <div className="rounded-md border border-line bg-surface p-4">
          {/* Two rows of digits — under `tabular` they line up column for
              column, which is what the odometer needs. "1 8,240" with a gap
              after the 1 is what a proportional 1 does. */}
          <div className="tabular text-[2.5rem] font-bold leading-none tracking-[-0.02em] text-fg-strong">
            18,240
          </div>
          <div className="tabular text-[2.5rem] font-bold leading-none tracking-[-0.02em] text-fg-muted">
            11,111
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.06em] text-fg-muted">
            parcels delivered · tabular-nums
          </div>
        </div>
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="text-sm font-semibold text-fg-strong">Waiting for Skydrop to see it</div>
          <p className="mt-1 text-sm leading-relaxed text-fg-body">
            Nothing is credited until we see it on our statement. Reference{' '}
            <span className="font-mono text-[13px] text-fg-strong">SD-2026-26-000009</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function TintPanel({
  hue,
  title,
  body,
}: {
  hue: string;
  title: string;
  body: string;
}): ReactElement {
  return (
    <div
      className="rounded-lg border p-6"
      style={{
        background: `var(--${hue}-tint)`,
        borderColor: `var(--${hue}-line)`,
        color: `var(--${hue}-on-tint)`,
      }}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.08em] opacity-80">{hue} tint</div>
      <h3 className="mt-2 text-2xl font-bold" style={{ color: 'inherit' }}>
        {title}
      </h3>
      <p className="mt-2 max-w-[48ch] text-[15px] leading-relaxed">{body}</p>
      <p className="mt-4 text-sm text-fg-body">
        Neutral body text on the same tint — this is how a real section reads.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function SwatchesPage(): ReactElement {
  const decMinWhite = gradientMin(CORRIDOR_STOPS.decorative, '#ffffff');
  const decMinDark = gradientMin(CORRIDOR_STOPS.decorative, '#020617');
  const strMinWhite = gradientMin(CORRIDOR_STOPS.strong, '#ffffff');
  const strMinDark = gradientMin(CORRIDOR_STOPS.strong, '#020617');
  const decSamples = sampleGradient(CORRIDOR_STOPS.decorative, 3);
  const strSamples = sampleGradient(CORRIDOR_STOPS.strong, 3);
  const largeTextOk = HUES.filter(
    (h) => h.id !== 'slate' && contrast(h.scale[600], PAGE.light) >= 3,
  );

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 py-8 text-fg-body sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
            Skydrop marketing rebuild · Phase 1 · dev route
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Swatches, tokens and type specimens</h1>
          <p className="mt-2 max-w-[70ch] text-sm text-fg-muted">
            Every ratio is computed (WCAG 2.x) against the page grounds — light{' '}
            <code className="font-mono">{PAGE.light}</code>, dark{' '}
            <code className="font-mono">{PAGE.dark}</code>. ✓ = AA text (≥ 4.5), ~ = large text / UI
            (≥ 3), ✗ = fails. Outlined steps are the TEXT steps: L on the light page (700, or 600
            for blue and violet), D on the dark page (400 everywhere).
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">1 · Hue scales, each with a meaning</h2>
        {HUES.map((h) => (
          <ScaleRow key={h.id} hue={h} />
        ))}
        <p className="text-xs text-fg-muted">
          Large display text (≥ 24 px, or ≥ 18.66 px bold) may use 600 on the light page where it
          clears 3:1 — qualifies:{' '}
          {largeTextOk
            .map((h) => `${h.name} (${contrast(h.scale[600], PAGE.light).toFixed(2)})`)
            .join(', ')}
          . Saffron qualifies with no margin (3.03) — treat as 700 in practice.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">2 · Semantic tokens in use — chips, fills</h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Drawn with <code className="font-mono">--{'{hue}'}-tint / -on-tint / -line</code> and{' '}
          <code className="font-mono">--{'{hue}'}-fill / -on-fill</code> — the tokens a component
          reads; never a raw step. Warning and danger always carry an icon (saffron doubles as the
          Send-to-India direction).
        </p>
        <div className="flex flex-wrap gap-6">
          <TokenChip
            hue="saffron"
            label="Warning · counted short"
            icon={<TriangleAlert size={14} aria-hidden />}
          />
          <TokenChip hue="red" label="Danger · refused" icon={<OctagonX size={14} aria-hidden />} />
          <TokenChip hue="green" label="Delivered" icon={<Check size={14} aria-hidden />} />
          <TokenChip hue="saffron" label="Send to India (direction)" />
          <TokenChip hue="teal" label="Import · Stock-in" />
          <TokenChip hue="violet" label="Export · Catalogue" />
          <TokenChip hue="magenta" label="E-commerce sellers" />
          <TokenChip hue="blue" label="Team" />
        </div>
        <div className="flex flex-wrap gap-3">
          {HUES.filter((h) => h.id !== 'slate').map((h) => (
            <span
              key={h.id}
              className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold"
              style={{ background: `var(--${h.id}-fill)`, color: `var(--${h.id}-on-fill)` }}
            >
              {h.id === 'blue'
                ? 'Primary CTA · blue-600'
                : `${h.name} solid · ${FILL[h.id]?.step ?? ''}`}
            </span>
          ))}
        </div>
      </section>

      <section id="dark-tints" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          3 · Magenta tint beside red tint — as whole surfaces
        </h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Finding C: at pink-950 the dark magenta tint was a maroon indistinguishable from red-950.
          The magenta ramp now turns to plum from 800 (#8a1263 → #611047 → #42092f, hue ≈ 320°), so
          in dark mode the Returns tab and the Sellers section separate from an error zone by HUE.
          On-tint text keeps AA (magenta-400 on plum-950: <Ratio fg="#f472b6" bg="#42092f" />;
          red-400 on red-950: <Ratio fg="#f87171" bg="#450a0a" />
          ).
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TintPanel
            hue="magenta"
            title="Returns, handled unit by unit"
            body="A parcel comes back; two identical units are inspected and go to three trays — put back in stock, keep aside (damaged), write off."
          />
          <TintPanel
            hue="red"
            title="Refused by the courier"
            body="A danger surface for comparison. This is the ONLY use of red: something has gone wrong and needs a person."
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">4 · The corridor gradient — one declaration</h2>
        <div className="grid grid-cols-1 gap-5">
          <GradientBar
            css={CORRIDOR.decorative}
            label="--corridor-gradient (SHIPS)"
            note={`decorative only — arcs, the scroll-progress line, highlights. Never carries text: white bottoms out at ${decMinWhite.ratio.toFixed(2)}:1 over ${decMinWhite.at}; slate-950 stays ≥ ${decMinDark.ratio.toFixed(2)}:1 but the rule is no text at all.`}
          />
          <GradientBar
            css={CORRIDOR.decorativeOklch}
            label="same three stops, in oklch (comparison only)"
            note="adopt only if visibly as golden or better; otherwise the sRGB declaration above stands."
          />
          <GradientBar
            css={CORRIDOR.strong}
            label="--corridor-gradient-strong (for bands that carry WHITE text)"
            note={`green-700 → saffron-700. White never drops below ${strMinWhite.ratio.toFixed(2)}:1 (at ${strMinWhite.at}); slate-950 bottoms out at ${strMinDark.ratio.toFixed(2)}:1, so dark text is NOT allowed on it.`}
          >
            <span className="text-lg font-bold text-white">
              Ready to ship into India? — white on the strong gradient
            </span>
          </GradientBar>
        </div>
        <div className="overflow-x-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="text-fg-muted">
              <tr>
                <th className="py-1 pr-4">gradient</th>
                <th className="py-1 pr-4">green end</th>
                <th className="py-1 pr-4">midpoint</th>
                <th className="py-1 pr-4">saffron end</th>
                <th className="py-1 pr-4">min white</th>
                <th className="py-1 pr-4">min slate-950</th>
              </tr>
            </thead>
            <tbody className="font-mono text-fg-body">
              {[
                ['decorative', decSamples, decMinWhite, decMinDark],
                ['strong', strSamples, strMinWhite, strMinDark],
              ].map(([name, samples, mw, md]) => {
                const s = samples as string[];
                const w = mw as { ratio: number; at: string };
                const d = md as { ratio: number; at: string };
                return (
                  <tr key={String(name)} className="border-t border-line">
                    <td className="py-1 pr-4 font-sans font-semibold">{String(name)}</td>
                    {s.map((hex) => (
                      <td key={hex} className="py-1 pr-4">
                        <span
                          className="mr-1 inline-block h-3 w-3 rounded-sm align-middle"
                          style={{ background: hex }}
                        />
                        {hex} · W {contrast('#ffffff', hex).toFixed(2)} · S{' '}
                        {contrast('#020617', hex).toFixed(2)}
                      </td>
                    ))}
                    <td className="py-1 pr-4">{w.ratio.toFixed(2)}</td>
                    <td className="py-1 pr-4">{d.ratio.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="type" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          5 · Type specimens — headings now follow the candidate
        </h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Each card sets <code className="font-mono">--font-sans-face</code> to its candidate, and
          h1/h2 follow <code className="font-mono">--font-sans</code> (the global rule that pinned
          headings to Plex by name is gone). The render script prints{' '}
          <code className="font-mono">getComputedStyle(h1).fontFamily</code> per card as proof. DM
          Sans was dropped (62.7 KB; 36.9 KB wght-only — both over the 35 KB budget). JetBrains Mono
          stays for waybills, serials and SKUs only and is not preloaded.
        </p>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {CANDIDATES.map((c) => (
            <Specimen key={c.id} c={c} />
          ))}
        </div>
      </section>
    </main>
  );
}
