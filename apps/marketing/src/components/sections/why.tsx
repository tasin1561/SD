import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { BarChart3, Boxes, Home, Languages, ShieldCheck, Truck, Undo2 } from 'lucide-react';
import { platform } from '@/content/site';
import { SectionHeading } from './section-heading';
import '@/components/micro/list-row/list-row.css';
import './sections.css';
import './why.css';

const ICONS = {
  boxes: Boxes,
  truck: Truck,
  undo: Undo2,
  chart: BarChart3,
  languages: Languages,
  home: Home,
} as const;

/**
 * SECTION — Why Skydrop. Six reasons as u21 rows (icon chip in the row's
 * hue, title, one line) in a two-column grid; rows lift and gain their
 * accent bar on hover exactly as the drawer's do. Server-rendered.
 */
export function Why(): ReactElement {
  return (
    <section id="why" className="sec sec--raised" aria-labelledby="why-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="why-h2"
          hue="violet"
          eyebrow="Why Skydrop"
          icon={<ShieldCheck size={14} />}
          title="Built like an operation, not a listing"
          sub="Each of these is a thing the system does, not a promise. Ask to see it working before you ship."
        />
        <ul className="why__grid">
          {platform.why.map((w, i) => {
            const Icon = ICONS[w.icon as keyof typeof ICONS] ?? ShieldCheck;
            return (
              <Reveal
                as="li"
                key={w.title}
                delay={i * 60}
                className="row why__row"
                data-hue={w.hue}
              >
                <span className="row__chip" aria-hidden>
                  <Icon size={18} />
                </span>
                <span className="row__text">
                  <span className="row__title">{w.title}</span>
                  <span className="row__helper why__body">{w.body}</span>
                </span>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
