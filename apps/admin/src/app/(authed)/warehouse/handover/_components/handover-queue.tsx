'use client';

import type { ReactElement } from 'react';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Package } from 'lucide-react';
import '../../_components/benches.css';
import { useHandoverQueue, type WaitingHandover } from '@/lib/ops-hooks';
import { useT } from '@/i18n/client';

/**
 * What is standing at the bench, waiting for a van.
 *
 * The question a loader actually asks — "is that everything?" — was
 * unanswerable here: the bench had a scan box and a list of what had
 * already been done, so the only way to know what was LEFT was to count
 * boxes on the floor. It draws from the same `HANDOVER_READY` set the
 * scan enforces, so it can never offer a parcel the scan would refuse.
 *
 * A parcel already scanned stays on the list, marked, until it is
 * dispatched. Removing rows as they are scanned makes the remaining pile
 * impossible to check against — and a half-loaded van is precisely when
 * somebody needs to.
 */
export function HandoverQueue(): ReactElement {
  const tr = useT();
  const t = useT();
  const q = useHandoverQueue();

  if (q.isLoading) {
    return (
      <section className="wh-card">
        <SkeletonRows
          rows={4}
          cols={3}
          label={t('warehouseHandoverHandoverQueue.loadingWhatIsWaiting')}
        />
      </section>
    );
  }
  if (q.isError) {
    return (
      <ErrorState
        message={t('warehouseHandoverHandoverQueue.couldNotLoadWhatIs')}
        retry={() => void q.refetch()}
      />
    );
  }

  const waiting = q.data ?? [];
  if (waiting.length === 0) {
    return (
      <EmptyState
        tone="positive"
        title={t('warehouseHandoverHandoverQueue.nothingWaitingForAVan')}
        description={t('warehouseHandoverHandoverQueue.parcelsAppearHereOnceThey')}
      />
    );
  }

  const scanned = waiting.filter((w) => w.handoverScannedAtIso !== null).length;

  return (
    <section className="wh-card" data-flush="1">
      <div className="wh-card__head">
        <h2 className="wh-card__title">
          <span className="sk-figure">{waiting.length}</span> waiting for a van
        </h2>
        <div className="wh-card__sub">
          {t('warehouseHandoverHandoverQueue.oldestFirst', {
            value:
              scanned > 0 ? tr('warehouseHandoverHandoverQueue.alreadyChecked', { scanned }) : '',
          })}
        </div>
      </div>
      <ul className="wh-list">
        {waiting.map((w) => (
          <WaitingRow key={w.shipmentId} pack={w} />
        ))}
      </ul>
    </section>
  );
}

function WaitingRow({ pack }: { pack: WaitingHandover }): ReactElement {
  const t = useT();
  const checked = pack.handoverScannedAtIso !== null;
  return (
    <li className={checked ? 'wh-quiet' : undefined}>
      <ListRow
        icon={<Package size={16} />}
        title={<span className="sk-ident">{pack.awbNumber}</span>}
        description={
          <>
            <span className="sk-ident">{pack.shipmentNumber}</span> ·{' '}
            <span className="sk-ident">{pack.orderNumber ?? '—'}</span>
            {pack.recipientName === null ? '' : ` · ${pack.recipientName}`} · {pack.courierCode}
          </>
        }
        status={
          checked ? (
            <StatusChip kind="delivered" label="checked" size="sm" />
          ) : (
            <StatusChip
              kind="neutral"
              label={t('warehouseHandoverHandoverQueue.notScanned')}
              size="sm"
            />
          )
        }
      />
    </li>
  );
}
