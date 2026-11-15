'use client';

import { useId, useState, type CSSProperties, type ReactElement } from 'react';
import Link from 'next/link';
import { OctagonX, XCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CancelRequestResult } from '@skydrop/api-client';
import { useApiClient } from '@skydrop/auth/client';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { Notice } from '../../_components/orders-parts';

/**
 * "Cancel order" once the parcel is past the point this store can cancel it
 * directly (2026-11-15, owner). Still on screen; pressing it asks Skydrop by
 * ticket. While that ticket is open the button is visible but disabled
 * (`aria-disabled`, so it stays focusable and the reason is reachable), with
 * the reason as a muted second line. The server decides whether it is on
 * offer at all (`cancelRequest.available`; the seller's cancel policy OFF
 * means no button, as before).
 */
const wrap: CSSProperties = { display: 'inline-flex', flexDirection: 'column', gap: 2 };
const reasonStyle: CSSProperties = {
  fontSize: '0.75rem',
  lineHeight: 1.3,
  color: 'var(--fg-muted)',
  overflowWrap: 'anywhere',
};

function useRaiseCancelRequest(orderId: string) {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation<CancelRequestResult, Error, { note?: string }>({
    mutationFn: (body) =>
      client.request<CancelRequestResult>(`/api/store/orders/${orderId}/cancel-request`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
      void qc.invalidateQueries({ queryKey: ['store-tickets'] });
    },
  });
}

export function CancelRequestAction({
  orderId,
  orderNumber,
  openTicket,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly openTicket: { readonly id: string; readonly number: string } | null;
}): ReactElement {
  const t = useT();
  const reasonId = useId();
  const raise = useRaiseCancelRequest(orderId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const blocked = openTicket !== null;
  const done = raise.data;

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync(note.trim() === '' ? {} : { note: note.trim() });
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  function close(): void {
    setOpen(false);
    setError(null);
    setNote('');
    raise.reset();
  }

  return (
    <>
      <span style={wrap}>
        <Button
          variant="ghost"
          icon={<XCircle size={15} />}
          onClick={blocked ? undefined : () => setOpen(true)}
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          style={blocked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
        >
          {t('ordd.cancelOrder')}
        </Button>
        {openTicket !== null ? (
          <span id={reasonId} style={reasonStyle}>
            {t('cancelRequest.open', { number: openTicket.number })}
          </span>
        ) : null}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
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
              <Link href={`/tickets/${done.ticket.id}`}>{t('cancelRequest.viewTicket')}</Link>
              <Button variant="primary" onClick={close}>
                {t('cancelRequest.done')}
              </Button>
            </DialogFooter>
          )
        }
      >
        {done === undefined ? (
          <>
            <p>{t('cancelRequest.body')}</p>
            {error !== null ? (
              <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
                <span>{error}</span>
              </Notice>
            ) : null}
            <TextArea
              label={t('cancelRequest.noteLabel')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              showCount
            />
          </>
        ) : (
          <p role="status">
            {t(done.created ? 'cancelRequest.raised' : 'cancelRequest.alreadyOpen', {
              number: done.ticket.number,
            })}
          </p>
        )}
      </Dialog>
    </>
  );
}
