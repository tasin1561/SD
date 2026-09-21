import type { ReactElement } from 'react';
import { PackageOpen } from 'lucide-react';
import { platform } from '@/content/site';
import { GoodsClient } from '@/components/islands/goods-client';
import { SectionHeading } from './section-heading';
import './sections.css';
import './goods.css';

/**
 * SECTION — What you can and cannot send. A u04 filter bar over the border
 * rules, each card carrying its verdict as an icon AND a word.
 */
export function Goods(): ReactElement {
  return (
    <section id="goods" className="sec sec--raised" aria-labelledby="goods-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="goods-h2"
          hue="teal"
          eyebrow="What you can send"
          icon={<PackageOpen size={14} />}
          title="What crosses the border, and what does not"
          sub="The corridor's staples ship every day. A few categories need a look first, and some are not carried at all — we would rather say so here than at the counter."
        />
        <GoodsClient goods={platform.goods} />
      </div>
    </section>
  );
}
