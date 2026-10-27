'use client';

import { useState, type ReactElement } from 'react';
import { OctagonX, PhoneCall } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from './orders-parts';
import { verdict } from '@/i18n/verdict';
import { useRequestReattempt } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';

const MIN_REASON = 20;

/**
 * Asking for one more call on an order the customer declined.
 *
 * Worded as a request throughout, because that is what it is: an admin
 * decides. The customer said no, and a seller who could put the order
 * back in the queue unaided is a seller who can have somebody rung
 * repeatedly after they refused.
 */
export function ReattemptRequestDialog({
  orderId,
  orderNumber,
  open,
  onOpenChange,
}: {
  readonly orderId: string;
  /** Restated in the dialog so the ask names the order it is about. */
  readonly orderNumber?: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const t = useT();
  const request = useRequestReattempt();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const typed = reason.trim().length;
  const remaining = Math.max(0, MIN_REASON - typed);

  function close(): void {
    setReason('');
    request.reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t('orderDialogs.askUsToCall')}
      description={t('orderDialogs.theCustomerDeclinedThis')}
      icon={<PhoneCall size={18} />}
      locked={request.isPending}
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={request.isPending}>
            {t('orderDialogs.cancel2')}
          </Button>
          <AsyncButton
            state={request.isPending ? 'busy' : undefined}
            labels={{ idle: t('orderDialogs.sendRequest'), busy: t('orderDialogs.sending') }}
            disabled={remaining > 0 || request.isPending}
            onClick={() =>
              request.mutate(
                { orderId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    // The banner behind the dialog says the same thing and
                    // persists; this is the acknowledgement for the moment
                    // the dialog disappears.
                    toast.success(t('orderDialogs.requestSentWeWill'));
                    close();
                  },
                },
              )
            }
          />
        </DialogFooter>
      }
    >
      <div className="ord-stack ord-stack--tight">
        {orderNumber !== undefined && (
          <div className="sk-confirm__subject">
            <span className="sk-confirm__entity sk-ident">{orderNumber}</span>
          </div>
        )}
        <TextArea
          id="ra-reason"
          label={t('orderDialogs.whyShouldWeCall')}
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('orderDialogs.atLeastCharactersE', { minReason: MIN_REASON })}
          // The counter is part of the hint, not a separate line: the
          // minimum is only interesting while you are short of it, and the
          // send button gives no clue why it is disabled.
          hint={
            <>
              {t('orderDialogs.whatDoYouKnow')}{' '}
              {remaining > 0 ? (
                <span className="ord-tone-warn">
                  {t(
                    remaining === 1
                      ? 'orderDialogs.moreCharacterNeeded'
                      : 'orderDialogs.moreCharactersNeeded',
                    { remaining },
                  )}
                </span>
              ) : (
                <span className="ord-faint">{t('orderDialogs.typedCharacters', { typed })}</span>
              )}
            </>
          }
        />

        {request.error !== null && (
          <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
            <span>{verdict(request.error, t)}</span>
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
