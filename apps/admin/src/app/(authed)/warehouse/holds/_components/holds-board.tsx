'use client';

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';
import { Boxes, Hand, PackageOpen, Printer, RefreshCw, ClipboardList } from 'lucide-react';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip, type StatusChipKind } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useFloorHolds,
  type FloorHold,
  type FloorHoldKind,
  type LabelReprint,
} from '@/lib/activity-hooks';
import { actorIsPerson, actorLabel, clockTime } from '@/lib/activity-format';
import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';
import './holds.css';

/**
 * "Who has what" — every live hold on the floor.
 *
 * ── WHAT A HOLD READS AS ─────────────────────────────────────────────
 * Three states, and the difference between them is the point of the
 * screen:
 *
 *   HELD    — somebody has it until a clock time. Go and ask them.
 *   FREE    — the window has passed. Nobody has it, whatever name is on
 *             the row. Walking off to find Karim for a lapsed claim is
 *             exactly the waste this avoids.
 *   STUCK   — free, and free for long enough that something went wrong
 *             (the packer went home mid-box). The loudest row.
 *
 * The SERVER decides which, against the instant it read the database,
 * and that instant is printed at the top — so the screen is honest about
 * how old it is instead of pretending to be live.
 *
 * ── ABSOLUTE TIMES, ALWAYS ───────────────────────────────────────────
 * "Theirs until 2:40 pm", never "for 23 more minutes". This board gets
 * left open on a bench screen and re-read; a relative time would be
 * silently wrong by then, and a wrong hold sends somebody walking.
 */
const ICONS: Readonly<Record<FloorHoldKind, ReactElement>> = {
  PICK: <Hand size={16} aria-hidden />,
  PACK_CLAIM: <Boxes size={16} aria-hidden />,
  PACK_BOX: <PackageOpen size={16} aria-hidden />,
  PICK_BATCH: <ClipboardList size={16} aria-hidden />,
};

export function HoldsBoard(): ReactElement {
  const t = useT();
  const holds = useFloorHolds();

  const data = holds.data;
  const counts = {
    held: data === undefined ? 0 : data.holds.filter((h) => !h.expired).length,
    free: data === undefined ? 0 : data.holds.filter((h) => h.expired && !h.stuck).length,
    stuck: data === undefined ? 0 : data.holds.filter((h) => h.stuck).length,
  };

  return (
    <div className="hb-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('holds.title')}
            <InfoButton title={t('holds.title')} text={t('holds.subtitle')} />
          </span>
        }
        action={
          <div className="hb-head">
            {data !== undefined && (
              <>
                <span className="hb-counts sk-figure">{t('holds.counts', counts)}</span>
                <span className="hb-asof sk-figure">
                  {t('holds.asOf', { time: clockTime(data.nowIso) })}
                </span>
              </>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void holds.refetch()}
              disabled={holds.isFetching}
              aria-busy={holds.isFetching}
            >
              <RefreshCw size={14} aria-hidden className={holds.isFetching ? 'hb-spin' : ''} />
              {t('holds.refresh')}
            </Button>
          </div>
        }
      />

      {holds.isPending ? (
        <SkeletonRows rows={5} cols={2} label={t('holds.loading')} />
      ) : holds.isError || data === undefined ? (
        <ErrorState message={serverVerdict(holds.error)} retry={() => void holds.refetch()} />
      ) : (
        <>
          {data.holds.length === 0 ? (
            <EmptyState title={t('holds.empty')} icon={<Hand size={20} aria-hidden />} />
          ) : (
            <ul className="hb-grid">
              {data.holds.map((hold, index) => (
                <HoldCard
                  key={hold.key}
                  hold={hold}
                  index={index}
                  stuckAfterMinutes={data.stuckAfterMinutes}
                />
              ))}
            </ul>
          )}

          <section className="hb-section">
            <div className="ez-titled">
              <SectionHeading title={t('holds.reprints.title')} />
              <InfoButton title={t('holds.reprints.title')} text={t('holds.reprints.note')} />
            </div>
            {data.reprints.length === 0 ? (
              <p className="hb-quiet">{t('holds.reprints.empty')}</p>
            ) : (
              <ul className="hb-reprints">
                {data.reprints.map((r) => (
                  <ReprintRow key={r.shipmentId} reprint={r} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function chipKindFor(hold: FloorHold): StatusChipKind {
  if (hold.stuck) return 'failed';
  if (hold.expired) return 'neutral';
  return 'held';
}

function HoldCard({
  hold,
  index,
  stuckAfterMinutes,
}: {
  readonly hold: FloorHold;
  readonly index: number;
  readonly stuckAfterMinutes: number;
}): ReactElement {
  const t = useT();
  // A live hold is worded by its own line ("Theirs until 2:40 pm"), so
  // the chip carries the state: stuck, free, or what kind of hold it is.
  const chipLabel = hold.stuck
    ? t('holds.stuck')
    : hold.expired
      ? t('holds.free')
      : t(`holds.kind.${hold.kind}`);
  const who = actorLabel(hold.holder, t);
  return (
    <li
      className="hb-card"
      data-state={hold.stuck ? 'stuck' : hold.expired ? 'free' : 'held'}
      style={{ '--hb-i': Math.min(index, 12) } as CSSProperties}
    >
      <div className="hb-card__top">
        <span className="hb-card__chip" aria-hidden>
          {ICONS[hold.kind]}
        </span>
        <span className="hb-card__kind">{t(`holds.kind.${hold.kind}`)}</span>
        <StatusChip kind={chipKindFor(hold)} label={chipLabel} size="sm" />
      </div>

      <p className="hb-card__who" data-person={actorIsPerson(hold.holder) ? 'yes' : 'no'}>
        {who}
      </p>

      <div className="hb-card__what">
        {hold.shipmentNumber !== null && (
          <span className="sk-ident hb-card__id">{hold.shipmentNumber}</span>
        )}
        {hold.batchNumber !== null && (
          <span className="sk-ident hb-card__id">{hold.batchNumber}</span>
        )}
        {hold.awbNumber !== null && <span className="sk-ident hb-card__awb">{hold.awbNumber}</span>}
        {hold.orderId !== null && hold.orderNumber !== null && (
          <Link
            className="hb-card__link"
            href={`/orders/${hold.orderId}`}
            aria-label={`${t('holds.openOrder')} ${hold.orderNumber}`}
          >
            {hold.orderNumber}
          </Link>
        )}
      </div>

      <div className="hb-card__times">
        <span className="sk-figure">
          {hold.sinceIso === null
            ? t('holds.noStart')
            : t('holds.since', { time: clockTime(hold.sinceIso) })}
        </span>
        <span className="sk-figure" data-free={hold.expired ? 'yes' : 'no'}>
          {hold.untilIso === null
            ? t('holds.noWindow')
            : hold.expired
              ? t('holds.lapsed', { time: clockTime(hold.untilIso) })
              : t('holds.until', { time: clockTime(hold.untilIso) })}
        </span>
      </div>

      <Progress hold={hold} />

      {hold.stuck && (
        <p className="hb-card__stuck">{t('holds.stuckNote', { minutes: stuckAfterMinutes })}</p>
      )}
      {hold.warehouseName !== null && <p className="hb-card__wh">{hold.warehouseName}</p>}
    </li>
  );
}

/** How much of a printed picking sheet is still on the floor. */
function Progress({ hold }: { readonly hold: FloorHold }): ReactElement | null {
  const t = useT();
  const d = hold.detail;
  if (d === null) return null;
  const unpicked = d['unpicked'];
  const of = d['of'];
  if (typeof unpicked !== 'number' || typeof of !== 'number' || of === 0) return null;
  const done = Math.max(0, Math.min(1, (of - unpicked) / of));
  return (
    <div className="hb-progress">
      <span className="hb-progress__label">{t('holds.progress', { unpicked, of })}</span>
      <span className="hb-progress__track" aria-hidden>
        <span className="hb-progress__fill" style={{ '--hb-done': done } as CSSProperties} />
      </span>
    </div>
  );
}

function ReprintRow({ reprint }: { readonly reprint: LabelReprint }): ReactElement {
  const t = useT();
  const who = actorLabel(reprint.lastPrintedBy, t);
  return (
    <li className="hb-reprint">
      <span className="hb-reprint__chip" aria-hidden>
        <Printer size={14} />
      </span>
      <span className="hb-reprint__ids">
        <span className="sk-ident">{reprint.shipmentNumber}</span>
        {reprint.orderId !== null && reprint.orderNumber !== null && (
          <Link
            className="hb-card__link"
            href={`/orders/${reprint.orderId}`}
            aria-label={`${t('holds.openOrder')} ${reprint.orderNumber}`}
          >
            {reprint.orderNumber}
          </Link>
        )}
      </span>
      <span className="hb-reprint__who">
        {reprint.lastPrintedAtIso === null
          ? t('holds.reprints.lastByUnknown', { who })
          : t('holds.reprints.lastBy', { who, time: clockTime(reprint.lastPrintedAtIso) })}
      </span>
      <span className="hb-reprint__counts sk-figure">
        {t('holds.reprints.sheets', { count: reprint.sheets })}
        {reprint.labelVersions > 1
          ? ` · ${t('holds.reprints.versions', { count: reprint.labelVersions })}`
          : ''}
      </span>
    </li>
  );
}
