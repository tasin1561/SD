'use client';

import { useState, type ReactElement } from 'react';
import { Check, CircleHelp, OctagonX } from 'lucide-react';
import { ChipSelect } from '@/components/micro/chip-select';
import type { platform } from '@/content/site';

type Good = (typeof platform.goods)[number];
type Verdict = Good['verdict'];
type Filter = 'all' | Verdict;

const VERDICT: Record<
  Verdict,
  { word: string; hue: 'green' | 'saffron' | 'red'; Icon: typeof Check }
> = {
  allowed: { word: 'Ships', hue: 'green', Icon: Check },
  case: { word: 'Case by case', hue: 'saffron', Icon: CircleHelp },
  restricted: { word: 'Not carried', hue: 'red', Icon: OctagonX },
};

export function GoodsClient({ goods }: { goods: readonly Good[] }): ReactElement {
  const [filter, setFilter] = useState<Filter[]>(['all']);
  const f = filter[0] ?? 'all';
  const count = (v: Verdict): number => goods.filter((g) => g.verdict === v).length;
  return (
    <div className="goods">
      <ChipSelect<Filter>
        label="Filter by verdict"
        hue="teal"
        value={filter}
        onChange={setFilter}
        chips={[
          { id: 'all', label: 'Everything', count: goods.length },
          {
            id: 'allowed',
            label: 'Ships',
            icon: <Check size={14} strokeWidth={3} />,
            count: count('allowed'),
          },
          {
            id: 'case',
            label: 'Case by case',
            icon: <CircleHelp size={14} />,
            count: count('case'),
          },
          {
            id: 'restricted',
            label: 'Not carried',
            icon: <OctagonX size={14} />,
            count: count('restricted'),
          },
        ]}
      />
      <ul className="goods__grid" aria-live="polite">
        {goods
          .filter((g) => f === 'all' || g.verdict === f)
          .map((g, i) => {
            const v = VERDICT[g.verdict];
            return (
              <li
                key={g.name}
                className="goods__card sec-card"
                data-hue={v.hue}
                style={{ '--i': i } as React.CSSProperties}
              >
                <span className="goods__verdict">
                  <span className="goods__verdict-ico" aria-hidden>
                    <v.Icon size={11} strokeWidth={3} />
                  </span>
                  {v.word}
                </span>
                <span className="goods__name">{g.name}</span>
                <span className="goods__note">{g.note}</span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
