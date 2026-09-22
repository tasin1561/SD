import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  FileText,
  MapPin,
  Stamp,
  Truck,
} from 'lucide-react';
import { Reveal } from '@/lib/reveal';
import { SweepLink } from '@/components/micro/sweep';
import { importExport } from '@/content/sections/import-export';
import type { ImportExportPanel, ImportExportStep } from '@/content/sections/import-export';
import { SectionHeading } from './section-heading';
import './sections.css';
import './import-export.css';

/**
 * SECTION — Import & export. Two colour-coded panels, one per direction:
 * importing from India (teal) and exporting to India (violet). Side by
 * side from `lg`, stacked below it.
 *
 * ── Why the rows are NOT `RowLink` ───────────────────────────────────
 * The same reasoning as contact's office block: a `RowLink` is a control
 * that goes somewhere, and "pickup" goes nowhere — there is no page
 * behind a step of the journey. So the rows are drawn with the row's
 * chrome (icon chip, title, one line) and none of its affordances: no
 * chevron, no hover lift, no pointer. The CTA carries the whole
 * affordance, and is the only thing in the panel anybody can click.
 *
 * ── Why `sec--raised` ────────────────────────────────────────────────
 * The band alternation runs Services (`sec--band`) → here → Coverage
 * (plain `sec`). Plain here would put two identical surfaces next to
 * each other, so this one is raised: band → raised → page.
 *
 * Every colour comes from the panel's own `data-hue` (`--h`, `--h-tint`,
 * `--h-text`, `--h-surface`, `--h-glow`, declared once in `sections.css`)
 * — this file names no hue itself, so re-hueing a panel is one word in
 * the content file.
 *
 * Server-rendered; the only client code is the shared `Reveal` observer,
 * which every section already carries.
 */

const STEP_ICONS: Record<ImportExportStep, LucideIcon> = {
  pickup: Truck,
  paperwork: FileText,
  customs: Stamp,
  lastmile: MapPin,
};

const PANEL_ICONS: Record<ImportExportPanel['id'], LucideIcon> = {
  import: ArrowDownLeft,
  export: ArrowUpRight,
};

export function ImportExport(): ReactElement {
  return (
    <section id="import-export" className="sec sec--raised" aria-labelledby="ie-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="ie-h2"
          hue="teal"
          eyebrow={importExport.eyebrow}
          icon={<ArrowLeftRight size={14} />}
          title={importExport.title}
          sub={importExport.sub}
        />

        <ul className="ie">
          {importExport.panels.map((p, i) => {
            const PanelIcon = PANEL_ICONS[p.id];
            return (
              <Reveal
                as="li"
                key={p.id}
                delay={i * 80}
                className="ie__panel sec-card"
                data-hue={p.hue}
              >
                <span className="sec-head__eyebrow ie__eyebrow">
                  <span className="sec-head__eyebrow-ico" aria-hidden>
                    <PanelIcon size={14} />
                  </span>
                  {p.eyebrow}
                </span>

                <h3 className="ie__title">{p.title}</h3>
                <p className="ie__who">{p.who}</p>

                <h4 className="ie__rows-h">{p.rowsHeading}</h4>
                <ul className="ie__rows">
                  {p.rows.map((r) => {
                    const Icon = STEP_ICONS[r.step];
                    return (
                      <li className="ie__row" key={r.step}>
                        <span className="ie__row-chip" aria-hidden>
                          <Icon size={16} />
                        </span>
                        <span className="ie__row-text">
                          <span className="ie__row-title">{r.title}</span>
                          <span className="ie__row-line">{r.line}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <SweepLink href={p.cta.href} tone={p.tone} className="ie__cta">
                  {p.cta.label}
                </SweepLink>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
