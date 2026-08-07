import type { ReactElement } from 'react';
import { SearchForm } from './_components/search-form';
import { LocaleSwitcher } from './_components/locale-switcher';
import { ThemeToggle } from './_components/theme-toggle';
import { getActiveLocale } from '@/lib/locale';
import { TiltPanel } from '@/lib/tilt';
import { CorridorConsole } from './_components/corridor-console';
import { t } from '@/lib/i18n';

/**
 * Public landing — anonymous AWB lookup, MISSION CONTROL skin.
 * Console-grid backdrop, phosphor bloom, panel with corner ticks,
 * telemetry chrome. Bilingual via the `lang` cookie.
 */
export default async function Home(): Promise<ReactElement> {
  const locale = await getActiveLocale();
  return (
    <div className="relative min-h-screen grid place-items-center bg-surface text-fg-body p-6 overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0" />
      {/* The corridor runs across the WHOLE page — ambient, behind everything */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        // The veil is a TOKEN. Halving the map is right on black and
        // wrong on white — it was what made the network unreadable.
        style={{ opacity: 'var(--map-veil)' }}
      >
        <CorridorConsole />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[480px] rounded-full"
        style={{
          background: 'radial-gradient(closest-side, var(--glow), transparent)',
          opacity: 0.45,
        }}
      />

      {/* Controls — pinned to the viewport corner, clear of the map */}
      <div className="absolute top-4 right-4 sm:top-5 sm:right-6 z-20 flex items-center gap-2">
        <ThemeToggle />
        <LocaleSwitcher active={locale} />
      </div>

      <div className="relative w-full max-w-md">
        <div className="boot-rise mb-6 text-center">
          {/* Each LINE opts in, not the block. One ellipse centred on the
              whole masthead leaves its bottom edge — the tagline — in the
              falloff, which measured 2.18:1 against a hub marker. */}
          <div data-map-text className="flex items-baseline justify-center gap-3">
            <span className="font-display font-semibold text-2xl tracking-tight text-fg-strong">
              {t(locale, 'brand')}
            </span>
            <span className="telemetry inline-flex items-center gap-1.5 text-fg-muted">
              <span aria-hidden className="status-dot inline-block h-1 w-1 rounded-full bg-green" />
              sys online
            </span>
          </div>
          <div data-map-text className="telemetry text-fg-muted mt-2">
            {t(locale, 'tagline')}
          </div>
        </div>

        <TiltPanel max={3} className="boot-rise boot-rise-2">
          {/* The lookup is a CONTROL, not content — see the note in
              globals.css on why it is the one dark object on a light
              page. Marked rather than restyled here: the recolour is a
              theme concern and this component is correct in dark. */}
          <div data-lookup-panel className="panel ticks relative overflow-hidden p-6 sm:p-7">
            {/* Was two mono micro-labels flanking the header — leftover
                console chrome. One quiet label survives; mono now denotes
                machine data only, which on this page is the AWB field. */}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-fg-muted text-xs font-medium tracking-wide">Parcel lookup</span>
            </div>
            <h1 className="text-fg-strong text-lg font-semibold mb-1">
              {t(locale, 'landingTitle')}
            </h1>
            <p className="text-fg-muted text-sm mb-6">{t(locale, 'landingSubtitle')}</p>
            <SearchForm locale={locale} />
            <div aria-hidden className="glow-follow" />
          </div>
        </TiltPanel>

        <p data-map-text className="telemetry text-fg-muted text-center mt-5">
          bd → in corridor · webhook tracking
        </p>
      </div>
    </div>
  );
}
