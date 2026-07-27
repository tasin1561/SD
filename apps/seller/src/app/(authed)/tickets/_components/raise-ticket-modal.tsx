'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useCreateTicket } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const MIN_SUBJECT = 3;

/**
 * Raise a parcel issue.
 *
 * The order/shipment fields are optional but strongly hinted, because a
 * ticket without one takes a support round-trip to place — and the
 * seller is the only person who can supply it cheaply.
 */
export function RaiseTicketModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const create = useCreateTicket();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setSubject('');
    setDescription('');
    setOrderId('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await create.mutateAsync({
        subject: subject.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...(orderId.trim() === '' ? {} : { orderId: orderId.trim() }),
      });
      toast.success('Issue raised. We will come back to you on the ticket.');
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      size="md"
      title="Raise an issue"
      description="Tell us what is wrong with the parcel. We will investigate and reply on the ticket."
    >
      <div className="space-y-3">
        <FormField label="Subject" htmlFor="ticket-subject" required>
          <Input
            id="ticket-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Parcel delivered damaged"
            autoComplete="off"
          />
        </FormField>

        <FormField
          label="Order"
          htmlFor="ticket-order"
          hint="Optional, but including it gets you an answer far faster. Copy the ID from the order page."
        >
          <Input
            id="ticket-order"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="0198f3c2-…"
            autoComplete="off"
          />
        </FormField>

        <FormField
          label="What happened"
          htmlFor="ticket-description"
          hint="What you expected, what actually arrived, and anything the customer told you."
        >
          <Textarea
            id="ticket-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={subject.trim().length < MIN_SUBJECT || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Raising…' : 'Raise issue'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
