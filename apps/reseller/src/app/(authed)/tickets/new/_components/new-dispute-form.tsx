'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, FormField, Input, Textarea } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The dispute form. It checks nothing the server checks (FE-2): whatever
 * the server refuses — not your order, not a reseller order, a subject too
 * short — is shown in the server's own words.
 */
export function NewDisputeForm({
  initialOrderId,
  pending,
  submit,
  onDone,
}: {
  readonly initialOrderId: string;
  readonly pending: boolean;
  readonly submit: (body: {
    orderId: string;
    subject: string;
    description?: string;
  }) => Promise<{ id: string }>;
  readonly onDone: (id: string) => void;
}): ReactElement {
  const [orderId, setOrderId] = useState(initialOrderId);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const t = await submit({
        orderId: orderId.trim(),
        subject,
        ...(description.trim() === '' ? {} : { description }),
      });
      onDone(t.id);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <FormField label="Order" htmlFor="dispute-order" hint="The order this is about.">
        <Input
          id="dispute-order"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          required
        />
      </FormField>
      <FormField label="What is wrong" htmlFor="dispute-subject">
        <Input
          id="dispute-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
        />
      </FormField>
      <FormField label="Tell us more" htmlFor="dispute-description">
        <Textarea
          id="dispute-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
        />
      </FormField>
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Raise the dispute
      </Button>
    </form>
  );
}
