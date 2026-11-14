'use client';

import { AwbCopy } from '@skydrop/ui/app/awb-copy';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Clock, Package, User } from 'lucide-react';
import '../../_components/benches.css';
import { usePackQueue, type PackInProgress, type WaitingPack } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * What is waiting on the bench.
 *
 * The station is scan-driven and had nothing else on it, so a packer
 * could only discover a parcel by holding its label — which answers
 * "what is this?" and never "what is left?". This is that second
 * question: oldest first, the same set and the same predicate the pull
 * uses, so the list can never show a parcel the bench would refuse.
 *
 * It is a VIEW. Nothing here claims a parcel — the box does that, and
 * claiming from a list would let a click take a parcel out from under
 * somebody already holding it.
 *
 * A parcel with no printed label is called out rather than hidden: it
 * is the one thing on this list somebody has to go and DO something
 * about, because a box is opened by scanning a label that does not yet
 * exist.
 */
export function PackQueueList(): ReactElement {
  const t = useT();

  const q = usePackQueue();

  if (q.isLoading) {
    return (
      <section className="wh-card">
        <SkeletonRows
          rows={4}
          cols={3}
          label={t('warehousePackPackQueueList.loadingThePackQueue')}
        />
      </section>
    );
  }
  if (q.isError) {
    return (
      <ErrorState
        message={t('warehousePackPackQueueList.couldNotLoadThePack')}
        retry={() => void q.refetch()}
      />
    );
  }

  // PACK-4: `waiting` is what THIS packer may take; `inProgress` is what
  // another bench is holding. BOTH are drawn (2026-11-10): a parcel that
  // simply vanished from the queue is the thing a packer walks over to
  // ask about, and "Rahim has it until 11:05" is the answer — on screen,
  // before they ask.
  const waiting = q.data?.waiting ?? [];
  const inProgress = q.data?.inProgress ?? [];
  if (waiting.length === 0) {
    return (
      <>
        <EmptyState
          tone="positive"
          title={t('warehousePackPackQueueList.nothingWaitingToBePacked')}
          description={t('warehousePackPackQueueList.parcelsAppearHereOnceThey')}
        />
        <InProgressSection rows={inProgress} />
      </>
    );
  }

  const unlabelled = waiting.filter((w) => w.labelPrintedAtIso === null).length;

  return (
    <section className="wh-card" data-flush="1">
      <div className="wh-card__head">
        <h2 className="wh-card__title">
          {richMessage(t('warehousePackPackQueueList.waitingToBePacked'), {
            span: <span className="sk-figure">{waiting.length}</span>,
          })}
        </h2>
        <div className="wh-card__sub">{t('warehousePackPackQueueList.oldestFirstScanALabel')}</div>
      </div>
      {unlabelled > 0 && (
        <p className="wh-card__note">
          {richMessage(t('warehousePackPackQueueList.noPrintedLabelYetA'), {
            unlabelled,
            value:
              unlabelled === 1
                ? t('warehousePackPackQueueList.parcelHas')
                : t('warehousePackPackQueueList.parcelsHave'),
            link: (
              <Link href="/warehouse/printing" className="wh-link">
                printing
              </Link>
            ),
          })}
        </p>
      )}
      <ul className="wh-list">
        {waiting.map((w) => (
          <WaitingRow key={w.shipmentId} pack={w} />
        ))}
      </ul>
      <InProgressSection rows={inProgress} />
    </section>
  );
}

/**
 * What another bench is holding, and until when.
 *
 * Nothing here is actionable, which is the point: it exists so a parcel
 * that left the waiting list has somewhere to be seen. A packer who can
 * read "another bench has it until 11:05" does not go looking for a
 * supervisor, and two people do not both go hunting for one carton.
 *
 * A hold whose holder cannot be NAMED says "another bench" rather than a
 * uuid — a packer cannot act on an id, and a blank where a name should be
 * reads as a bug.
 */
function InProgressSection({ rows }: { rows: readonly PackInProgress[] }): ReactElement | null {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <div className="wh-inprog">
      <div className="wh-card__head">
        <h3 className="wh-card__title wh-card__title--sm">
          {richMessage(t('warehousePackPackQueueList.onAnotherBench'), {
            span: <span className="sk-figure">{rows.length}</span>,
          })}
        </h3>
        <div className="wh-card__sub">{t('warehousePackPackQueueList.theseComeBackOnTheir')}</div>
      </div>
      <ul className="wh-list">
        {rows.map((r) => (
          <InProgressRow key={r.shipmentId} row={r} />
        ))}
      </ul>
    </div>
  );
}

function InProgressRow({ row }: { row: PackInProgress }): ReactElement {
  const t = useT();
  const who = row.heldByName ?? t('warehousePackPackQueueList.anotherBench');
  return (
    <li>
      <ListRow
        icon={<Package size={16} />}
        title={
          row.awbNumber === null ? (
            <span className="sk-ident">{row.shipmentNumber}</span>
          ) : (
            <AwbCopy awb={row.awbNumber} size="inherit" />
          )
        }
        description={
          <>
            <span className="sk-ident">{row.orderNumber ?? '—'}</span>
            {' · '}
            <User size={12} className="wh-inline-icon" /> {who}
            {' · '}
            <Clock size={12} className="wh-inline-icon" />{' '}
            <span className="sk-figure">{clockTime(row.heldUntilIso)}</span>
          </>
        }
        status={
          <StatusChip
            // A token kind, never a hex: 'in-transit' for a box being
            // filled right now, 'pending' for a parcel merely claimed.
            kind={row.hold === 'BOX' ? 'in-transit' : 'pending'}
            label={
              row.hold === 'BOX'
                ? t('warehousePackPackQueueList.boxOpen')
                : t('warehousePackPackQueueList.pulled')
            }
            size="sm"
          />
        }
      />
    </li>
  );
}

/**
 * A wall-clock time in the warehouse's own zone — the same shape the pack
 * bench and the server's refusals use, so no two places on this screen
 * disagree about what time a hold lapses. 24-hour, Western numerals.
 */
function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function WaitingRow({ pack }: { pack: WaitingPack }): ReactElement {
  const t = useT();
  const labelled = pack.labelPrintedAtIso !== null;
  return (
    <li>
      <ListRow
        icon={<Package size={16} />}
        title={
          pack.awbNumber === null ? (
            <span className="sk-ident">{pack.shipmentNumber}</span>
          ) : (
            <AwbCopy awb={pack.awbNumber} size="inherit" />
          )
        }
        description={
          <>
            <span className="sk-ident">{pack.orderNumber ?? '—'}</span>
            {pack.recipientName === null ? '' : ` · ${pack.recipientName}`} · {pack.courierCode}
          </>
        }
        meta={
          <span className="sk-figure">
            {pack.itemCount} {pack.itemCount === 1 ? 'line' : 'lines'}
          </span>
        }
        status={
          labelled ? (
            <StatusChip
              kind="confirmed"
              label={t('warehousePackPackQueueList.labelPrinted')}
              size="sm"
            />
          ) : (
            <StatusChip kind="pending" label={t('warehousePackPackQueueList.noLabel')} size="sm" />
          )
        }
        {...(labelled
          ? {}
          : {
              severity: 'medium' as const,
              severityLabel: t('warehousePackPackQueueList.needsALabel'),
            })}
      />
    </li>
  );
}
