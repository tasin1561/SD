'use client';

import { useState, type ReactElement } from 'react';
import { useCreateInvitation } from '@/lib/api-hooks';
import { Button, FormActions, FormField, Input, Modal, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';

/**
 * Invite-a-seller dialog. Email-only — the API generates the
 * invitation token + sends the welcome email. On success the panel
 * closes; the invitations panel + sellers list both invalidate.
 */
export function CreateInvitationDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
}): ReactElement {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateInvitation();
  const toast = useToast();

  function close(): void {
    setEmail('');
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    try {
      const trimmed = email.trim();
      await create.mutateAsync({ email: trimmed });
      toast.success(`Invitation sent to ${trimmed}`);
      close();
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const body = err.body as { message?: unknown };
        setError(typeof body.message === 'string' ? body.message : err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to send invitation.');
      }
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Invite a seller"
      description="An invitation email with a one-time registration link will be sent. The invitee creates their account; you can monitor it from the invitations panel."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="space-y-3"
      >
        <FormField label="Email address" htmlFor="invite-email" required error={error ?? undefined}>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            required
            placeholder="seller@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={create.isPending}
          />
        </FormField>
        <FormActions>
          <Button variant="ghost" size="md" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
