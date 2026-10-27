'use client';

import { useState, type ReactElement } from 'react';
import { Mail, Send } from 'lucide-react';
import { useCreateInvitation } from '@/lib/api-hooks';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { phaseOf } from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      setError(t('sellersCreateInvitationDialog.emailIsRequired'));
      return;
    }
    try {
      const trimmed = email.trim();
      await create.mutateAsync({ email: trimmed });
      toast.success(t('sellersCreateInvitationDialog.invitationSentTo', { trimmed }));
      close();
    } catch (err) {
      setError(serverVerdict(err, t('sellersCreateInvitationDialog.failedToSendInvitation')));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={t('sellersCreateInvitationDialog.inviteAClient')}
      description={t('sellersCreateInvitationDialog.anInvitationEmailWithA')}
      icon={<Mail size={18} />}
      locked={create.isPending}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="ac-form"
      >
        <TextField
          label={t('sellersCreateInvitationDialog.emailAddress')}
          id="invite-email"
          type="email"
          autoComplete="off"
          required
          placeholder="client@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={create.isPending}
          error={error ?? undefined}
        />
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close} disabled={create.isPending}>
            {t('sellersCreateInvitationDialog.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            type="submit"
            icon={<Send size={15} />}
            state={phaseOf(create.isPending, error)}
            labels={{
              idle: t('sellersCreateInvitationDialog.sendInvitation'),
              busy: t('sellersCreateInvitationDialog.sending'),
              error: t('sellersCreateInvitationDialog.notSent'),
            }}
          />
        </DialogFooter>
      </form>
    </Dialog>
  );
}
