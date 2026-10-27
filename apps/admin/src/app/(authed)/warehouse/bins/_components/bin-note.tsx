'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { Translate } from '@skydrop/ui/app/i18n';
import { richMessage, useT } from '@/i18n/client';
import { tEn, type MessageKey } from '@/i18n/catalog';

/** A bin type in words an operator uses, in the given language. */
export function binTypeLabelIn(tr: Translate<MessageKey>, type: string): string {
  switch (type) {
    case 'STORAGE':
      return tr('warehouseBinsBinNote.storage');
    case 'PICKING':
      return tr('warehouseBinsBinNote.picking');
    case 'RECEIVING':
      return tr('warehouseBinsBinNote.receiving');
    case 'PACKING':
      return tr('warehouseBinsBinNote.packing');
    case 'RTO_HOLD':
      return tr('warehouseBinsBinNote.returnsHold');
    case 'DAMAGED':
      return tr('warehouseBinsBinNote.damaged');
    case 'QUARANTINE':
      return tr('warehouseBinsBinNote.quarantine');
    case 'TRANSIT':
      return tr('warehouseBinsBinNote.inTransit');
    default:
      return type;
  }
}

/** A bin type in words an operator uses (English — for specs and non-React callers). */
export function binTypeLabel(type: string): string {
  return binTypeLabelIn(tEn, type);
}

/**
 * What stock in a non-pickable bin MEANS — said plainly, because a number
 * sitting in "R-01-01" reads as stock you can sell, and it is not (BIN-2).
 * Nothing for an ordinary shelf.
 */
export function BinNote({ type }: { readonly type: string }): ReactElement | null {
  const t = useT();
  switch (type) {
    case 'RTO_HOLD':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          {richMessage(t('warehouseBinsBinNote.rtoHoldNote'), {
            link: (
              <Link href="/warehouse/rto?tab=bench" className="stk-link">
                {t('warehouseBinsBinNote.rtoHoldLink')}
              </Link>
            ),
          })}
        </p>
      );
    case 'DAMAGED':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          {t('warehouseBinsBinNote.damagedNote')}
        </p>
      );
    case 'QUARANTINE':
      return (
        <p className="stk-note bin-note" data-tone="bad">
          {t('warehouseBinsBinNote.quarantineNote')}
        </p>
      );
    case 'TRANSIT':
      return <p className="stk-note bin-note">{t('warehouseBinsBinNote.transitNote')}</p>;
    default:
      return null;
  }
}
