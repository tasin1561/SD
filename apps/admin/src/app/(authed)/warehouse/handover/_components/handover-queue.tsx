'use client';

import type { ReactElement } from 'react';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Package } from 'lucide-react';
import '../../_components/benches.css';
import { useHandoverQueue, type WaitingHandover } from '@/lib/ops-hooks';
import { useParcelLastTouch, type ParcelLastTouch } from '@/lib/activity-hooks';
import { actorLabel, clockTime } from '@/lib/activity-format';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
  const t = useT();

  const q = useHandoverQueue();
  // One line per row: who was last at this parcel. Several packers work
  // in parallel, so the loader holding a box wants to know whose box it
  // was before asking anybody anything. One request for the whole list.
  const lastTouch = useParcelLastTouch((q.data ?? []).map((w) => w.shipmentId));

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
          {richMessage(t('warehouseHandoverHandoverQueue.waitingForAVan'), {
            span: <span className="sk-figure">{waiting.length}</span>,
          })}
        </h2>
        <div className="wh-card__sub">
          {t('warehouseHandoverHandoverQueue.oldestFirst', {
            value:
              scanned > 0 ? t('warehouseHandoverHandoverQueue.alreadyChecked', { scanned }) : '',
          })}
        </div>
      </div>
      <ul className="wh-list">
        {waiting.map((w) => (
          <WaitingRow
            key={w.shipmentId}
            pack={w}
            lastTouch={lastTouch.data?.get(w.shipmentId) ?? null}
          />
        ))}
      </ul>
    </section>
  );
}

function WaitingRow({
  pack,
  lastTouch,
}: {
  pack: WaitingHandover;
  lastTouch: ParcelLastTouch | null;
}): ReactElement {
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
            {lastTouch !== null && (
              <>
                <br />
                <span className="wh-faint">
                  {t('activity.trail.lastTouch', {
                    who: actorLabel(lastTouch.actor, t),
                    time: clockTime(lastTouch.atIso),
                  })}
                </span>
              </>
            )}
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
