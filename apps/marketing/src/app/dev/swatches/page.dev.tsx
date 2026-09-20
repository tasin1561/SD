import { OctagonX, TriangleAlert, Check } from 'lucide-react';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { CSSProperties, ReactElement } from 'react';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { CORRIDOR, HUES, PAGE, STEPS, contrast, grade, ratio, type HueScale } from './palette';

/**
 * Phase 0 swatch page — a DEV ROUTE. `page.dev.tsx` is only picked up when
 * `MARKETING_DEV_ROUTES=1` puts `dev.tsx` in `pageExtensions`; a plain
 * `next build` (CI, deploy.sh) never compiles it, so nothing here can reach
 * the export. Renders every proposed hue scale with computed contrast, the
 * magenta-vs-danger-red proof, the corridor gradient three ways, the
 * warning/danger icon rule, and type specimens for the two candidates and the reference row.
 *
 * Theme: the root layout's `themeInitScript` + the existing ThemeToggle —
 * screenshot it twice with `sd-theme` set to `light` and `dark`.
 */

export const metadata: Metadata = {
  title: 'Swatches — Phase 0 (dev)',
  robots: { index: false, follow: false },
};

// ── Type candidates: variable latin woff2, committed, none preloaded here ──
// (this page is the only consumer; the chosen family is preloaded in Phase 1).
// The unicode-range literal is written out per call — next/font is a compiler
// transform and reads literals only; a shared const fails the BUILD (not
// typecheck, not lint) with "Font loader values must be explicitly written
// literals". The root layout says the same and this page proved it again.

const jakarta = localFont({
  src: '../../fonts/candidates/plus-jakarta-sans-latin.woff2',
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
const instrument = localFont({
  src: '../../fonts/candidates/instrument-sans-latin.woff2',
  variable: '--font-cand-instrument',
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
  name: string;
  role: 'candidate' | 'reference';
  cls: string;
  file: string;
  note: string;
}

const CANDIDATES: readonly Candidate[] = [
  {
    name: 'Plus Jakarta Sans',
    role: 'candidate',
    cls: jakarta.className,
    file: 'plus-jakarta-sans-latin.woff2',
    note: 'Geometric with soft terminals; confident at display sizes; strong numerals. wght 200–800.',
  },
  {
    name: 'Manrope',
    role: 'candidate',
    cls: manrope.className,
    file: 'manrope-latin.woff2',
    note: 'Geometric grotesque, slightly wide, calm; the most even body texture. wght 200–800.',
  },
  {
    name: 'Instrument Sans',
    role: 'reference',
    cls: instrument.className,
    file: 'instrument-sans-latin.woff2',
    note: 'Reference row only — named by the brand skill for headings. wght 400–700 cut (the wdth-axis cut is 57 KB).',
  },
];

function fileSize(name: string): number {
  try {
    return statSync(join(process.cwd(), 'src/app/fonts/candidates', name)).size;
  } catch {
    return 0;
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Ratio({ fg, bg }: { fg: string; bg: string }): ReactElement {
  const r = contrast(fg, bg);
  const g = grade(r);
  return (
    <span className="font-mono text-[11px] tabular-nums" data-grade={g} title={`${fg} on ${bg}`}>
      {r.toFixed(1)}
      <span className="text-fg-faint"> {g === 'AA' ? '✓' : g === 'AA-large' ? '~' : '✗'}</span>
    </span>
  );
}

function ScaleRow({ hue }: { hue: HueScale }): ReactElement {
  const lightText = hue.scale[hue.light];
  const darkText = hue.scale[hue.dark];
  return (
    <section className="rounded-md border border-line bg-surface-2 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-fg-strong">
          {hue.name}
          <span className="ml-2 text-sm font-normal text-fg-muted">{hue.meaning}</span>
        </h3>
        <p className="text-xs text-fg-muted">
          text on light page ({hue.light}): <Ratio fg={lightText} bg={PAGE.light} /> · text on dark
          page ({hue.dark}): <Ratio fg={darkText} bg={PAGE.dark} /> · white on {hue.light} fill:{' '}
          <Ratio fg="#ffffff" bg={lightText} />
        </p>
      </header>
      <ol className="grid grid-cols-6 gap-1 sm:grid-cols-11">
        {STEPS.map((step) => {
          const hex = hue.scale[step];
          const isLight = step === hue.light;
          const isDark = step === hue.dark;
          return (
            <li key={step} className="flex flex-col gap-1">
              <div
                className="h-12 rounded-sm"
                style={{
                  background: hex,
                  outline: isLight || isDark ? '2px solid var(--fg-strong)' : undefined,
                  outlineOffset: 1,
                }}
                title={hex}
              />
              <div className="font-mono text-[10px] leading-tight text-fg-muted">
                <div className="text-fg-body">
                  {step}
                  {isLight ? ' L' : ''}
                  {isDark ? ' D' : ''}
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

function Chip({
  hue,
  label,
  icon,
}: {
  hue: HueScale;
  label: string;
  icon?: ReactElement;
}): ReactElement {
  // A chip carries its hue's text step on its 50/950 tint — computed below.
  const styleLight: CSSProperties = {
    color: hue.scale[hue.light],
    background: hue.scale[50],
    borderColor: hue.scale[200],
  };
  const styleDark: CSSProperties = {
    color: hue.scale[hue.dark],
    background: hue.scale[950],
    borderColor: hue.scale[800],
  };
  return (
    <div className="flex flex-col gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium"
        style={styleLight}
      >
        {icon}
        {label}
      </span>
      <span className="text-[11px] text-fg-muted">
        light chip: <Ratio fg={hue.scale[hue.light]} bg={hue.scale[50]} />
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium"
        style={styleDark}
      >
        {icon}
        {label}
      </span>
      <span className="text-[11px] text-fg-muted">
        dark chip: <Ratio fg={hue.scale[hue.dark]} bg={hue.scale[950]} />
      </span>
    </div>
  );
}

function GradientBar({
  css,
  label,
  note,
}: {
  css: string;
  label: string;
  note: string;
}): ReactElement {
  return (
    <figure className="flex flex-col gap-1">
      <div className="h-10 rounded-md" style={{ background: css }} />
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
  const blue = HUES[0];
  const green = HUES[2];
  return (
    <section className={`${c.cls} rounded-md border border-line bg-surface-2 p-5`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <h3 className="text-lg font-semibold text-fg-strong">
          {c.name}
          {c.role === 'reference' ? (
            <span className="ml-2 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
              reference
            </span>
          ) : null}
        </h3>
        <p className="font-mono text-xs tabular-nums text-fg-muted">
          {c.file} · {kb(size)}{' '}
          <span style={{ color: within ? green?.scale[600] : HUES[6]?.scale[700] }}>
            {within ? '≤ 35 KB ✓' : '> 35 KB ✗'}
          </span>
        </p>
      </header>
      <p className="mb-4 text-sm text-fg-muted">{c.note}</p>

      <h1 className="text-[clamp(2rem,4.5vw,3.25rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg-strong text-balance">
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
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-5 text-sm font-semibold"
          style={{ background: blue?.scale[600], color: '#fff' }}
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
          <div className="text-[2.5rem] font-bold leading-none tabular-nums tracking-[-0.02em] text-fg-strong">
            18,240
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.06em] text-fg-muted">
            parcels delivered
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

// ── Page ───────────────────────────────────────────────────────────────

export default function SwatchesPage(): ReactElement {
  const magenta = HUES[5];
  const red = HUES[6];
  const saffron = HUES[1];
  const green = HUES[2];
  const blue = HUES[0];
  if (!magenta || !red || !saffron || !green || !blue) throw new Error('palette incomplete');

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 py-8 text-fg-body sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
            Skydrop marketing rebuild · Phase 0 · dev route
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-fg-strong">
            Swatches and type specimens
          </h1>
          <p className="mt-2 max-w-[70ch] text-sm text-fg-muted">
            Every ratio is computed (WCAG 2.x) against the two page grounds from theme.css — light{' '}
            <code className="font-mono">{PAGE.light}</code>, dark{' '}
            <code className="font-mono">{PAGE.dark}</code>. ✓ = AA text (≥ 4.5), ~ = large text / UI
            (≥ 3), ✗ = fails. Outlined steps are the ones the plan uses as text: L on the light
            page, D on the dark page.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg-strong">
          1 · Hue scales, each with a meaning
        </h2>
        {HUES.map((h) => (
          <ScaleRow key={h.id} hue={h} />
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg-strong">2 · Magenta beside danger red</h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Coral (#e11d48) sat too close to danger; the Sellers and Returns groups would have read as
          errors. Magenta 600/400 next to red 700/400, as chips and as the text steps on both
          grounds.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-surface-2 p-4">
            <h3 className="mb-3 text-sm font-semibold text-fg-strong">
              Magenta — E-commerce sellers · Returns
            </h3>
            <div className="mb-3 grid grid-cols-11 gap-1">
              {STEPS.map((s) => (
                <div
                  key={s}
                  className="h-8 rounded-sm"
                  style={{ background: magenta.scale[s] }}
                  title={magenta.scale[s]}
                />
              ))}
            </div>
            <Chip hue={magenta} label="E-commerce sellers" />
          </div>
          <div className="rounded-md border border-line bg-surface-2 p-4">
            <h3 className="mb-3 text-sm font-semibold text-fg-strong">Red — danger only</h3>
            <div className="mb-3 grid grid-cols-11 gap-1">
              {STEPS.map((s) => (
                <div
                  key={s}
                  className="h-8 rounded-sm"
                  style={{ background: red.scale[s] }}
                  title={red.scale[s]}
                />
              ))}
            </div>
            <Chip hue={red} label="Refused by courier" icon={<OctagonX size={14} aria-hidden />} />
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Distance check — magenta 600 vs red 700: {ratio(magenta.scale[600], red.scale[700])}:1
          luminance contrast is low by design (they are both mid-dark), so the separation has to
          come from HUE: magenta leans blue, red leans orange. Judge it by eye above; the icon rule
          below is the backstop.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg-strong">
          3 · The corridor gradient, three ways
        </h2>
        <div className="grid grid-cols-1 gap-5">
          <GradientBar
            css={CORRIDOR.oklch}
            label="in oklch"
            note="what ships where supported — the hue sweeps through yellow without dulling."
          />
          <GradientBar
            css={CORRIDOR.srgbFallback}
            label="sRGB fallback"
            note="declared first, with a warm mid-stop at 60% so older engines never dip through olive."
          />
          <GradientBar
            css={CORRIDOR.srgbNaive}
            label="naive sRGB (NOT shipped)"
            note="two stops, straight-line mix — the muddy middle this rule exists to avoid."
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg-strong">
          4 · Warning and danger are never colour alone
        </h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Saffron doubles as the Send-to-India direction, so a warning without an icon would read as
          a route. Every warning carries a triangle and a word; every danger an octagon and a word;
          success a check.
        </p>
        <div className="flex flex-wrap gap-8">
          <Chip
            hue={saffron}
            label="Warning · counted short"
            icon={<TriangleAlert size={14} aria-hidden />}
          />
          <Chip hue={red} label="Danger · refused" icon={<OctagonX size={14} aria-hidden />} />
          <Chip hue={green} label="Delivered" icon={<Check size={14} aria-hidden />} />
          <Chip hue={saffron} label="Send to India (direction, no icon)" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg-strong">5 · Type specimens</h2>
        <p className="max-w-[70ch] text-sm text-fg-muted">
          Two candidates for headings + UI — Plus Jakarta Sans and Manrope — plus one reference row.
          DM Sans was dropped: 62.7 KB with its opsz axis, 36.9 KB even as a wght-only cut, both
          over the 35 KB budget (the gate in Phase 1). Each file is the variable latin subset as
          Google serves it. JetBrains Mono stays for waybills, serials and SKUs only and is not
          preloaded.
        </p>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {CANDIDATES.map((c) => (
            <Specimen key={c.name} c={c} />
          ))}
        </div>
      </section>
    </main>
  );
}
