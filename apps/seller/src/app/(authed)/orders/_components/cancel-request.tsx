'use client';

import { useId, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { OctagonX, XCircle } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { Notice } from './orders-parts';
import { useRaiseCancelRequest } from '@/lib/api-hooks';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import './cancel-request.css';

/**
 * "Cancel order" once the parcel is past the point the client can cancel it
 * directly (2026-11-15, owner). It is still on screen; pressing it asks
 * Skydrop by ticket. While that ticket is open the button is visible but
 * disabled, with the reason as a muted second line.
 *
 * `aria-disabled` rather than `disabled`: the button stays focusable so a
 * keyboard or screen-reader user reaches the reason instead of skipping a
 * control that silently vanished from the tab order.
 */
export function CancelRequestButton({
  openTicket,
  onClick,
}: {
  readonly openTicket: { readonly id: string; readonly number: string } | null;
  readonly onClick: () => void;
}): ReactElement {
  const t = useT();
  const reasonId = useId();
  const blocked = openTicket !== null;
  return (
    <span className="crq">
      <Button
        variant="ghost"
        size="md"
        icon={<XCircle size={16} />}
        onClick={blocked ? undefined : onClick}
        aria-disabled={blocked ? true : undefined}
        aria-describedby={blocked ? reasonId : undefined}
        className="cod-actions__cancel crq__btn"
      >
        {t('orderPage.cancelOrder')}
      </Button>
      {openTicket !== null && (
        <span id={reasonId} className="crq__reason">
          {t('cancelRequest.open', { number: openTicket.number })}
        </span>
      )}
    </span>
  );
}

export function CancelRequestDialog({
  open,
  orderId,
  orderNumber,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const t = useT();
  const raise = useRaiseCancelRequest(orderId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = raise.data;

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync(note.trim().length > 0 ? { note: note.trim() } : {});
    } catch (err) {
      // The server's own words (FE-2).
      setError(verdict(err, t));
    }
  }

  function close(): void {
    onOpenChange(false);
    setError(null);
    setNote('');
    raise.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
      title={t('cancelRequest.title', { orderNumber })}
      icon={<XCircle size={18} />}
      size="sm"
      locked={raise.isPending}
      footer={
        done === undefined ? (
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={raise.isPending}>
              {t('cancelRequest.notNow')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={raise.isPending ? 'busy' : undefined}
              labels={{ idle: t('cancelRequest.send'), busy: t('cancelRequest.sending') }}
              onClick={() => void submit()}
            />
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Link href={`/tickets/${done.ticket.id}`} className="crq__link">
              {t('cancelRequest.viewTicket')}
            </Link>
            <Button variant="primary" onClick={close}>
              {t('cancelRequest.done')}
            </Button>
          </DialogFooter>
        )
      }
    >
      <div className="ord-stack ord-stack--tight">
        {done === undefined ? (
          <>
            <p className="ord-p">{t('cancelRequest.body')}</p>
            {error !== null && (
              <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
                <span>{error}</span>
              </Notice>
            )}
            <TextField
              label={t('cancelRequest.noteLabel')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        ) : (
          <p className="ord-p" role="status">
            {t(done.created ? 'cancelRequest.raised' : 'cancelRequest.alreadyOpen', {
              number: done.ticket.number,
            })}
          </p>
        )}
      </div>
    </Dialog>
  );
}
