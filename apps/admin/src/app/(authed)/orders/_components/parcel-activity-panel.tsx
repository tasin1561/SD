'use client';

import type { CSSProperties, ReactElement } from 'react';
import {
  BadgeCheck,
  Boxes,
  ClipboardList,
  FileCheck2,
  Hand,
  PackageCheck,
  PackageOpen,
  Printer,
  RotateCcw,
  ScanLine,
  SearchCheck,
  Tag,
  Truck,
  XCircle,
} from 'lucide-react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useParcelActivity,
  type ParcelActivityEvent,
  type ParcelActivityKind,
  type ParcelActivityParcel,
} from '@/lib/activity-hooks';
import { actorIsPerson, actorLabel, clockTime } from '@/lib/activity-format';
import { OoSection } from './order-ops-parts';
import './parcel-activity.css';

/**
 * "Who did what" — the parcel activity trail, beside the journey.
 *
 * ── WHY IT LIVES HERE ────────────────────────────────────────────────
 * This is where the question is already asked. Somebody investigating a
 * box that went to the wrong customer, or a parcel that never left, is
 * on the order page with the journey in front of them; the journey says
 * WHAT happened to the parcel and this says WHO made it happen. A
 * separate page would mean leaving the thing you are asking about.
 *
 * ── READING MATERIAL, NOT A CONTROL ──────────────────────────────────
 * Nothing here acts. The permission is the API's (`orders.view`, the
 * same gate as the page), and `usePermission` only decides whether to
 * SPEND the request — FE-2: the server is law and this is cosmetic.
 */
const ICONS: Readonly<Record<ParcelActivityKind, ReactElement>> = {
  LABEL_GENERATED: <Tag size={14} aria-hidden />,
  LABEL_PRINTED: <Printer size={14} aria-hidden />,
  PICK_BATCH_CREATED: <ClipboardList size={14} aria-hidden />,
  PICK_BATCH_PRINTED: <Printer size={14} aria-hidden />,
  PICK_CLAIMED: <Hand size={14} aria-hidden />,
  PICKED: <PackageCheck size={14} aria-hidden />,
  PACK_BOX_OPENED: <PackageOpen size={14} aria-hidden />,
  PACK_BOX_CLOSED: <Boxes size={14} aria-hidden />,
  PACK_BOX_CANCELLED: <XCircle size={14} aria-hidden />,
  PACKED: <Boxes size={14} aria-hidden />,
  COURIER_CHOSEN: <Truck size={14} aria-hidden />,
  MANIFEST_CLOSED: <FileCheck2 size={14} aria-hidden />,
  MANIFEST_HANDOFF_CONFIRMED: <BadgeCheck size={14} aria-hidden />,
  HANDOVER_SCANNED: <ScanLine size={14} aria-hidden />,
  COURIER_PICKED_UP: <Truck size={14} aria-hidden />,
  RTO_RECEIVED: <RotateCcw size={14} aria-hidden />,
  RTO_INSPECTED: <SearchCheck size={14} aria-hidden />,
};

/** Which steps read as a warning rather than ordinary progress. */
const TONE: Partial<Readonly<Record<ParcelActivityKind, 'warn' | 'good'>>> = {
  PACK_BOX_CANCELLED: 'warn',
  RTO_RECEIVED: 'warn',
  PACKED: 'good',
  COURIER_PICKED_UP: 'good',
};

export function ParcelActivityPanel({
  orderId,
}: {
  readonly orderId: string;
}): ReactElement | null {
  const t = useT();
  const mayRead = usePermission('orders.view');
  const trail = useParcelActivity(mayRead ? orderId : '');

  if (!mayRead) return null;
  if (trail.isPending) {
    return (
      <OoSection title={t('activity.trail.title')}>
        <SkeletonRows rows={4} cols={1} label={t('activity.trail.loading')} />
      </OoSection>
    );
  }
  if (trail.isError || trail.data === undefined) {
    return (
      <OoSection title={t('activity.trail.title')}>
        <ErrorState message={serverVerdict(trail.error)} retry={() => void trail.refetch()} />
      </OoSection>
    );
  }

  const { parcels, events } = trail.data;
  return (
    <OoSection title={t('activity.trail.title')}>
      <p className="pa-sub">{t('activity.trail.subtitle')}</p>
      {events.length === 0 ? (
        <p className="pa-empty">{t('activity.trail.empty')}</p>
      ) : (
        <div className="pa-stack">
          {parcels.map((parcel) => (
            <ParcelTrail
              key={parcel.shipmentId}
              parcel={parcel}
              events={events.filter((e) => e.shipmentId === parcel.shipmentId)}
            />
          ))}
        </div>
      )}
    </OoSection>
  );
}

function ParcelTrail({
  parcel,
  events,
}: {
  readonly parcel: ParcelActivityParcel;
  readonly events: readonly ParcelActivityEvent[];
}): ReactElement {
  const t = useT();
  return (
    <section className="pa-parcel" aria-label={parcel.shipmentNumber}>
      <header className="pa-parcel__head">
        <span className="pa-parcel__id sk-ident">{parcel.shipmentNumber}</span>
        {parcel.awbNumber !== null && (
          <span className="pa-parcel__awb sk-ident">{parcel.awbNumber}</span>
        )}
        {parcel.superseded && (
          <span className="pa-chip" data-tone="warn">
            {t('activity.trail.superseded')}
          </span>
        )}
        <span className="pa-parcel__count sk-figure">
          {t('activity.trail.steps', { count: events.length })}
        </span>
      </header>

      {/* The one-line answer, for the person who only wants that. */}
      {parcel.lastTouch !== null && (
        <p className="pa-last">
          {t('activity.trail.lastTouch', {
            who: actorLabel(parcel.lastTouch.actor, t),
            time: clockTime(parcel.lastTouch.atIso),
          })}
        </p>
      )}

      <ol className="pa-list">
        {events.map((event, index) => (
          <TrailRow key={event.key} event={event} index={index} />
        ))}
      </ol>
    </section>
  );
}

function TrailRow({
  event,
  index,
}: {
  readonly event: ParcelActivityEvent;
  readonly index: number;
}): ReactElement {
  const t = useT();
  const who = actorLabel(event.actor, t);
  const tone = TONE[event.kind] ?? null;
  return (
    <li
      className="pa-row"
      {...(tone === null ? {} : { 'data-tone': tone })}
      // Stagger, capped so a long trail does not animate for seconds.
      style={{ '--pa-i': Math.min(index, 12) } as CSSProperties}
    >
      <span className="pa-row__chip" aria-hidden>
        {ICONS[event.kind]}
      </span>
      <div className="pa-row__body">
        <span className="pa-row__what">{t(`activity.step.${event.kind}`)}</span>
        <span className="pa-row__who" data-person={actorIsPerson(event.actor) ? 'yes' : 'no'}>
          {who}
        </span>
        <Details event={event} />
      </div>
      <time className="pa-row__when sk-figure" dateTime={event.atIso}>
        {event.atApproximate
          ? t('activity.trail.about', { time: clockTime(event.atIso) })
          : clockTime(event.atIso)}
      </time>
    </li>
  );
}

/**
 * The numbers beside a step: which sheet, which manifest, how many
 * copies. Enum values and document numbers are DATA and stay as they
 * are — only the words around them are translated.
 */
function Details({ event }: { readonly event: ParcelActivityEvent }): ReactElement | null {
  const t = useT();
  const d = event.detail;
  if (d === null) return null;
  const chips: string[] = [];
  if (typeof d['batchNumber'] === 'string')
    chips.push(t('activity.detail.batch', { value: d['batchNumber'] }));
  if (typeof d['manifestNumber'] === 'string')
    chips.push(t('activity.detail.manifest', { value: d['manifestNumber'] }));
  if (typeof d['version'] === 'number')
    chips.push(t('activity.detail.version', { value: d['version'] }));
  if (typeof d['sheets'] === 'number' && d['sheets'] > 1)
    chips.push(t('activity.detail.sheets', { count: d['sheets'] }));
  if (typeof d['printed'] === 'number' && d['printed'] > 1)
    chips.push(t('activity.detail.printed', { count: d['printed'] }));
  if (typeof d['lines'] === 'number') chips.push(t('activity.detail.lines', { count: d['lines'] }));
  if (chips.length === 0) return null;
  return (
    <span className="pa-row__detail">
      {chips.map((c) => (
        <span key={c} className="pa-chip">
          {c}
        </span>
      ))}
    </span>
  );
}
