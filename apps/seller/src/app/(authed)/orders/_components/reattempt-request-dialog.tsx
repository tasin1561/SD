'use client';

import { useState, type ReactElement } from 'react';
import { Button, ErrorNote, FormField, Modal, ModalFooter, Textarea } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useRequestReattempt } from '@/lib/api-hooks';

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
  open,
  onOpenChange,
}: {
  readonly orderId: string;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const request = useRequestReattempt();
  const [reason, setReason] = useState('');

  function close(): void {
    setReason('');
    request.reset();
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Ask us to call this customer again"
      description="The customer declined this order, so it will not be called again on its own. Tell us why another call is worth making and we will review it."
    >
      <FormField
        label="Why should we call again?"
        htmlFor="ra-reason"
        hint="What do you know that the last call did not? A wrong price quoted, the wrong item described, a message from the customer since."
      >
        <Textarea
          id="ra-reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Customer messaged us afterwards saying the agent quoted the wrong price — they still want the order at ₹2,300."
        />
      </FormField>

      {request.error !== null && <ErrorNote message={serverVerdict(request.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={reason.trim().length < MIN_REASON || request.isPending}
          onClick={() => request.mutate({ orderId, reason: reason.trim() }, { onSuccess: close })}
        >
          {request.isPending ? 'Sending…' : 'Send request'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
