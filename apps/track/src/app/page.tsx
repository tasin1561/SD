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
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[480px] rounded-full"
        style={{ background: 'radial-gradient(closest-side, var(--glow), transparent)', opacity: 0.45 }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-4 flex items-center justify-end gap-2">
          <ThemeToggle />
          <LocaleSwitcher active={locale} />
        </div>
        <div className="boot-rise mb-6 text-center">
          <div className="flex items-baseline justify-center gap-3">
            <span className="font-display font-semibold text-2xl tracking-tight text-fg-strong">
              {t(locale, 'brand')}
            </span>
            <span className="telemetry inline-flex items-center gap-1.5 text-fg-muted">
              <span aria-hidden className="status-dot inline-block h-1 w-1 rounded-full bg-green" />
              sys online
            </span>
          </div>
          <div className="telemetry text-fg-muted mt-2">{t(locale, 'tagline')}</div>
        </div>

        {/* Live corridor — the brand's signature, miniaturized */}
        <div className="boot-rise boot-rise-2 panel ticks relative h-44 sm:h-52 overflow-hidden mb-4">
          <div className="telemetry absolute top-2.5 left-1/2 -translate-x-1/2 z-10 text-fg-muted">
            corridor · live
          </div>
          <CorridorConsole />
        </div>

        <TiltPanel max={3} className="boot-rise boot-rise-3">
          <div className="panel ticks relative overflow-hidden p-6 sm:p-7">
            <div className="telemetry text-sky mb-3">lookup</div>
            <h1 className="text-fg-strong text-lg font-semibold mb-1">
              {t(locale, 'landingTitle')}
            </h1>
            <p className="text-fg-muted text-sm mb-6">
              {t(locale, 'landingSubtitle')}
            </p>
            <SearchForm locale={locale} />
            <div aria-hidden className="glow-follow" />
          </div>
        </TiltPanel>

        <p className="telemetry text-fg-muted text-center mt-5">
          bd → in corridor · webhook tracking
        </p>
      </div>
    </div>
  );
}
