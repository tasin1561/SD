import type { ReactElement } from 'react';
import { Scale } from 'lucide-react';
import { platform } from '@/content/site';
import { DataTable } from '@/components/micro/data-table';
import { SectionHeading } from './section-heading';
import './sections.css';

/**
 * SECTION — Compare. The same eight questions asked of all three routes
 * into India, as a u07 table (swipe cards below md). Estimates are marked
 * "est." on the cell. Server-rendered — no JS.
 */
export function Compare(): ReactElement {
  const { columns, rows } = platform.compare;
  return (
    <section id="compare" className="sec" aria-labelledby="compare-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="compare-h2"
          hue="blue"
          eyebrow="Compare"
          icon={<Scale size={14} />}
          title="Three ways to sell in India, side by side"
          sub="Set up your own Indian company, sell through a marketplace, or ship with us. The honest answer differs by question, so here are all eight."
        />
        <DataTable
          caption="Skydrop compared with running your own Indian entity and selling through a marketplace"
          columns={columns.map((c) => ({ ...c, primary: c.key === 'skydrop' }))}
          rows={rows.map((r) => ({
            label: r.label,
            cells: { skydrop: r.skydrop, diy: r.diy, marketplace: r.marketplace },
          }))}
        />
        <p className="sec-note" style={{ marginTop: '0.9rem' }}>
          Green is good for you, red is a cost to you, amber depends. “est.” marks a typical figure
          rather than something we measure; your own numbers depend on what you sell and where.
        </p>
      </div>
    </section>
  );
}
