'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { CopyCheck } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import '../../_components/orders.css';
import { useT, useLocale } from '@/i18n/client';
import { dateTag } from '@/i18n/format';

/**
 * "You already have an order to this customer that hasn't shipped."
 *
 * The decision the seller is making is not "do I want to continue" — it
 * is "is this the same order I already entered?". So the dialog leads
 * with the existing orders and what is in them, and the confirm button
 * stays inert until they have said they looked.
 *
 * It never refuses. A second genuine order to one customer is ordinary,
 * and a system that blocked it would train sellers to work around it.
 */

export interface DuplicateCandidate {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: string;
  readonly itemCount: number;
  readonly valueInr: string | null;
  readonly recipientName: string;
  /** Contains at least one of the same SKUs as the order being placed. */
  readonly sharesItems: boolean;
}

export function DuplicateOrderDialog({
  open,
  candidates,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly candidates: ReadonlyArray<DuplicateCandidate>;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const [acknowledged, setAcknowledged] = useState(false);
  const anySharedItems = candidates.some((c) => c.sharesItems);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setAcknowledged(false);
          onCancel();
        }
      }}
      title={t('orderNew.thisCustomerAlreadyHas')}
      icon={<CopyCheck size={18} />}
      tone="critical"
      footer={
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setAcknowledged(false);
              onCancel();
            }}
          >
            {t('orderNew.cancelAndCheck')}
          </Button>
          <AsyncButton
            variant="destructive"
            state={busy ? 'busy' : undefined}
            labels={{ idle: t('orderNew.placeItAnyway'), busy: t('orderNew.placing') }}
            disabled={!acknowledged || busy}
            onClick={onConfirm}
          />
        </DialogFooter>
      }
    >
      <div className="ord-stack ord-stack--tight">
        <p className="ord-p">
          {t(
            candidates.length === 1
              ? anySharedItems
                ? 'orderNew.dupOneShared'
                : 'orderNew.dupOne'
              : anySharedItems
                ? 'orderNew.dupManyShared'
                : 'orderNew.dupMany',
            { count: candidates.length },
          )}
        </p>

        <ul className="ord-mini-list">
          {candidates.map((c) => (
            <li key={c.orderId}>
              <div>
                <Link href={`/orders/${c.orderId}`} target="_blank" className="ord-link sk-ident">
                  {c.orderNumber}
                </Link>
                <span className="ord-sub">
                  {c.recipientName} ·{' '}
                  {t(c.itemCount === 1 ? 'orderNew.itemCountOne' : 'orderNew.itemCountMany', {
                    count: c.itemCount,
                  })}{' '}
                  · {new Date(c.placedAt).toLocaleDateString(dateTag(locale))}
                </span>
              </div>
              <div>
                <span className="ord-faint">{c.status.replaceAll('_', ' ').toLowerCase()}</span>
                {c.sharesItems && (
                  <span className="ord-sub ord-tone-warn">{t('orderNew.sameItems')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <Checkbox
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          label={t('orderNew.iHaveCheckedThis')}
        />
      </div>
    </Dialog>
  );
}
