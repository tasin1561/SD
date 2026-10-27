'use client';

import { useState, type ReactElement } from 'react';
import { Send, TriangleAlert } from 'lucide-react';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTimeBrowser } from '@/i18n/format';
import { verdict as toVerdict } from '@/i18n/verdict';
import {
  useChangeStoreConsignee,
  useStoreConsignee,
  useStoreConsigneeHistory,
} from '@/lib/order-hooks';
import { Notice, RoSection } from '../../_components/orders-parts';

/**
 * Correcting who the parcel is going to, once the COURIER holds the
 * address (owner, 2026-09-18).
 *
 * Before a waybill exists the store changes the order itself, from the
 * section above. After one, the courier is the only party who can change
 * where it goes — so this ASKS them, and the change is stored only if
 * they accept it. A refusal leaves the order carrying the address the
 * parcel is actually going to, and shows the courier's own words so they
 * can be repeated to the customer rather than paraphrased into
 * something softer.
 *
 * Asking restates the order, each change and what happens next in a
 * confirm first — the courier is reached the moment it is sent.
 *
 * ── WHY THE FIELDS GO GREY RATHER THAN VANISH ────────────────────────
 * Somebody looking for "can I fix the phone number" needs to find the
 * answer, and a section that disappears once the parcel is on the van
 * reads as a feature that does not exist. Greyed out with the reason
 * says what is actually true: it exists, and it is too late.
 *
 * ── WHY CITY AND PIN ARE SHOWN BUT NOT EDITABLE ──────────────────────
 * They are what the parcel was ROUTED on and it is already physically
 * somewhere because of them. Hiding them would invite the question;
 * showing them fixed answers it.
 */
export function StoreConsigneePanel({
  orderId,
  orderNumber,
}: {
  readonly orderId: string;
  /** Shown in the confirm; display only. */
  readonly orderNumber: string;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const info = useStoreConsignee(orderId);
  const history = useStoreConsigneeHistory(orderId);
  const change = useChangeStoreConsignee();

  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (info.isLoading) return <SkeletonRows rows={3} cols={1} />;
  if (info.isError) {
    // An order with no parcel yet is not an error, it is Tuesday: the
    // shipment is provisioned when the order is confirmed, so every
    // order before that would otherwise show a red failure for being at
    // a perfectly normal stage of its life.
    const code = (info.error as { body?: { code?: string } } | undefined)?.body?.code;
    if (code === 'NO_LIVE_PARCEL') return <div />;
    return <ErrorState message={toVerdict(info.error, t)} retry={() => void info.refetch()} />;
  }

  const d = info.data;
  // `isLoading` is false on a refetch with no data yet; narrow rather
  // than reach for a `!`.
  if (d === undefined) return <SkeletonRows rows={3} cols={1} />;
  const val = (draft: string | null, current: string): string => draft ?? current;
  const changed =
    val(name, d.currentName) !== d.currentName ||
    val(phone, d.currentPhone) !== d.currentPhone ||
    val(address, d.currentAddressLine1) !== d.currentAddressLine1;

  // What the request below will carry — for the confirm to restate.
  const asked: ReadonlyArray<readonly [string, string]> = [
    ...(name === null || name === d.currentName ? [] : [[t('consignee.name'), name] as const]),
    ...(phone === null || phone === d.currentPhone ? [] : [[t('consignee.phone'), phone] as const]),
    ...(address === null || address === d.currentAddressLine1
      ? []
      : [[t('consignee.address'), address] as const]),
  ];

  // A const arrow, not a `function`: a hoisted declaration loses the
  // narrowing above and would need a non-null assertion, which lint
  // forbids and which would be wrong the day the shape changes.
  const ask = async (): Promise<void> => {
    setVerdict(null);
    try {
      const res = await change.mutateAsync({
        orderId,
        ...(name === null || name === d.currentName ? {} : { name }),
        ...(phone === null || phone === d.currentPhone ? {} : { phone }),
        ...(address === null || address === d.currentAddressLine1 ? {} : { addressLine1: address }),
      });
      if (res.accepted) {
        toast.success(t('consignee.toast.accepted'));
        setName(null);
        setPhone(null);
        setAddress(null);
      } else {
        // NOT a toast: the store has a customer waiting on this answer
        // and needs to be able to read the courier's words back.
        setVerdict(
          res.message === null
            ? t('consignee.refused')
            : t('consignee.refusedSaid', { message: res.message }),
        );
      }
    } catch (err) {
      // Verbatim (FE-2): STORE_ACTION_NOT_ALLOWED,
      // STORE_ACTION_NEEDS_SELLER_NOW, COURIER_WILL_NOT_ACCEPT_CHANGES…
      setVerdict(toVerdict(err, t));
    }
  };

  return (
    <RoSection title={t('consignee.title')} note={t('consignee.note')}>
      <div className="ro-stack ro-stack--tight">
        <p className="ro-p">{d.reason}</p>
        <div className="ro-grid-2">
          <TextField
            id="consignee-name"
            label={t('consignee.name')}
            disabled={!d.editable}
            value={val(name, d.currentName)}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="consignee-phone"
            label={t('consignee.phone')}
            disabled={!d.editable}
            value={val(phone, d.currentPhone)}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField
            id="consignee-address"
            label={t('consignee.address')}
            hint={t('consignee.addressHint')}
            disabled={!d.editable}
            value={val(address, d.currentAddressLine1)}
            onChange={(e) => setAddress(e.target.value)}
          />
          <TextField
            id="consignee-routing"
            label={t('consignee.routedTo')}
            disabled
            value={`${d.city}, ${d.stateProvince} ${d.postalCode}`}
          />
        </div>

        {verdict !== null ? (
          <Notice tone="warn" role="status" icon={<TriangleAlert size={16} />}>
            <span>{verdict}</span>
          </Notice>
        ) : null}

        <div className="ro-row">
          <AsyncButton
            variant="secondary"
            icon={<Send size={15} />}
            state={change.isPending ? 'busy' : undefined}
            labels={{ idle: t('consignee.ask'), busy: t('consignee.asking') }}
            disabled={!d.editable || !changed || change.isPending}
            onClick={() => setConfirming(true)}
          />
        </div>

        {history.data !== undefined && history.data.length > 0 ? (
          <ul className="ro-log">
            {history.data.map((r) => (
              <li key={r.id}>
                {formatDateTimeBrowser(r.createdAt, locale)} —{' '}
                {r.courierAcceptedAt === null
                  ? r.courierMessage === null
                    ? t('consignee.history.refused')
                    : t('consignee.history.refusedWith', { message: r.courierMessage })
                  : t('consignee.history.accepted')}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('consignee.confirm.title')}
        entity={orderNumber}
        entityIsIdentifier
        consequence={t('consignee.confirm.consequence')}
        confirmLabel={t('consignee.ask')}
        cancelLabel={t('consignee.confirm.notYet')}
        // Resolves whatever the answer: the courier's reply (or a refusal)
        // is shown on the panel, exactly where it was shown before.
        onConfirm={() => ask()}
      >
        <ul className="ro-changes">
          {asked.map(([label, value]) => (
            <li key={label}>
              <span className="ro-faint">{label}: </span>
              <span>{value}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </RoSection>
  );
}
