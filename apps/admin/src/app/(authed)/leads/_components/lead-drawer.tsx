'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Check, Mail, Phone, Send } from 'lucide-react';
import {
  Button,
  DescriptionList,
  ErrorNote,
  FormField,
  Modal,
  ModalFooter,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { inviteLeadStatusKind } from '@skydrop/ui/status';
import { InviteLeadStatus } from '@skydrop/db';
import {
  useCreateInvitation,
  useResendInvitation,
  useSellerInvitationFor,
  useUpdateInviteLead,
  type InviteLead,
  type InviteLeadStatus as LeadStatus,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * One lead, opened from the queue.
 *
 * The list is for scanning and this is for acting, which is why the
 * notes box and the status control live here rather than on every row.
 * They used to be on every row: each lead was a tall card with an
 * always-open textarea, so a screen showed one lead and the queue could
 * not be read at all.
 */

const STATUS_COPY: Readonly<Record<string, string>> = {
  NEW: 'Nobody has looked at this yet.',
  CONTACTED: 'Someone has reached out and is waiting to hear back.',
  QUALIFIED: 'A real prospect. Worth onboarding.',
  CONVERTED: 'They became a seller.',
  DECLINED: 'Not a fit, or never replied. Say why in the notes.',
  SPAM: 'Junk. Kept rather than deleted, so the same address is recognised next time.',
};

const DIRECTION: Record<string, { label: string; unserved: boolean }> = {
  BD_TO_IN: { label: 'Bangladesh → India', unserved: false },
  IN_TO_BD: { label: 'India → Bangladesh', unserved: true },
  BOTH: { label: 'Both directions', unserved: true },
};

export function LeadDrawer({
  lead,
  onClose,
}: {
  readonly lead: InviteLead | null;
  readonly onClose: () => void;
}): ReactElement {
  const canWrite = usePermission('leads.manage');
  const canInvite = usePermission('sellers.invite');
  const toast = useToast();
  const update = useUpdateInviteLead();
  const invite = useCreateInvitation();
  const resend = useResendInvitation();
  const existing = useSellerInvitationFor(lead?.email ?? null);
  const [status, setStatus] = useState<LeadStatus>('NEW');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // Re-seed whenever a different lead is opened — otherwise the previous
  // lead's notes appear under this one's name, which is the kind of
  // mistake that ends up in a customer conversation.
  useEffect(() => {
    if (lead === null) return;
    setStatus(lead.status);
    setNotes(lead.notes ?? '');
    setError(null);
    setInviteUrl(null);
  }, [lead]);

  if (lead === null) return <></>;

  const dirty = status !== lead.status || notes !== (lead.notes ?? '');
  const direction = lead.shippingDirection === null ? null : DIRECTION[lead.shippingDirection];

  /**
   * Invite this lead to register, from the same place you read their
   * request.
   *
   * The alternative was copying the address, opening Sellers, and
   * pasting it into a second form — which is where the wrong email gets
   * typed, and it loses the connection between the request and the
   * invitation entirely.
   *
   * The status moves to QUALIFIED, not CONVERTED: an invitation sent is
   * not an account created. They become CONVERTED when they actually
   * register, which is not this button's business to claim.
   */
  async function sendInvite(): Promise<void> {
    if (lead === null) return;
    setError(null);
    try {
      const created = await invite.mutateAsync({ email: lead.email });
      setInviteUrl(created.inviteUrl);
      if (status === 'NEW' || status === 'CONTACTED') setStatus('QUALIFIED');
      toast.success(`Invitation sent to ${lead.email}`);
    } catch (e) {
      // The server's refusal is the useful part here — "that email
      // already has a Skydrop login" tells you exactly what happened.
      setError(serverVerdict(e));
    }
  }

  /**
   * Resend, which ROTATES the token.
   *
   * The earlier link cannot be shown again, and that is deliberate
   * rather than an oversight: only a hash of the token is stored, so
   * there is nothing to display. Resending issues a fresh link and
   * invalidates the old one — which is also what you want when the
   * reason for resending is that the first link went astray.
   */
  async function resendInvite(): Promise<void> {
    if (existing.data === null || existing.data === undefined) return;
    setError(null);
    try {
      const fresh = await resend.mutateAsync({ id: existing.data.id });
      setInviteUrl(fresh.inviteUrl);
      toast.success(`New invitation sent to ${fresh.email}`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function save(): Promise<void> {
    if (lead === null) return;
    setError(null);
    try {
      await update.mutateAsync({ id: lead.id, status, notes });
      toast.success(`${lead.companyName} updated`);
      onClose();
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <Modal open onOpenChange={(next) => !next && onClose()} title={lead.companyName}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            kind={inviteLeadStatusKind(lead.status as InviteLeadStatus)}
            label={lead.status.toLowerCase()}
          />
          {lead.submissionCount > 1 && (
            <span className="text-[var(--status-pending-fg)] text-xs">
              asked {lead.submissionCount}×
            </span>
          )}
          {direction?.unserved === true && (
            <span className="text-critical text-xs">
              {direction.label} — we do not run this corridor
            </span>
          )}
        </div>

        {/* Contact first, and one click each. Whoever opens this is about
            to get in touch; making them select-and-copy a phone number
            is the difference between a queue worked and a queue skimmed. */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a
            href={`mailto:${lead.email}`}
            className="text-accent inline-flex items-center gap-1.5 hover:underline"
          >
            <Mail size={13} /> {lead.email}
          </a>
          <a
            href={`tel:${lead.phone.replace(/\s+/g, '')}`}
            className="text-accent inline-flex items-center gap-1.5 hover:underline"
          >
            <Phone size={13} /> {lead.phone}
          </a>
          {lead.altPhone !== null && lead.altPhone !== '' && (
            <a
              href={`tel:${lead.altPhone.replace(/\s+/g, '')}`}
              className="text-accent inline-flex items-center gap-1.5 hover:underline"
            >
              <Phone size={13} /> {lead.altPhone}
            </a>
          )}
        </div>

        <DescriptionList
          items={[
            { label: 'Contact', value: lead.fullName },
            { label: 'Delivering to', value: direction?.label ?? '—' },
            { label: 'Sells', value: lead.productTypes ?? '—' },
            { label: 'Orders a month', value: lead.monthlyOrders ?? '—' },
            { label: 'Requested', value: new Date(lead.createdAt).toLocaleString() },
            {
              label: 'First contacted',
              value:
                lead.contactedAt === null ? 'not yet' : new Date(lead.contactedAt).toLocaleString(),
            },
          ]}
        />

        {lead.message !== null && lead.message !== '' && (
          <div>
            <div className="text-text-muted mb-1 text-xs">What they wrote</div>
            <p className="border-border text-text-body border-l-2 pl-3 text-sm whitespace-pre-wrap">
              {lead.message}
            </p>
          </div>
        )}

        <FormField label="Status" htmlFor="lead-status" hint={STATUS_COPY[status]}>
          <Select
            id="lead-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
          >
            {Object.keys(STATUS_COPY).map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Internal notes"
          htmlFor="lead-notes"
          hint="Never shown to the lead. What was said, what they need, when to call back."
        >
          <Textarea
            id="lead-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
        </FormField>

        {canInvite && (
          <div className="border-border rounded-xl border p-3">
            {existing.data === undefined ? (
              <div className="text-text-muted text-xs">Checking for an invitation…</div>
            ) : existing.data === null ? (
              // Nobody has invited them yet.
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-text-bright text-sm">Invite them to register</div>
                  <div className="text-text-muted text-xs">
                    Sends a registration link to {lead.email}.
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={invite.isPending}
                  onClick={() => void sendInvite()}
                >
                  <Send size={12} /> {invite.isPending ? 'Sending…' : 'Send invite'}
                </Button>
              </div>
            ) : existing.data.status === 'used' ? (
              // They accepted it. There is nothing to resend, and the
              // account exists — offering a button here would be an
              // invitation to break something.
              <div className="flex items-start gap-2">
                <Check size={13} className="text-[var(--status-delivered-fg)] mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="text-text-bright">They registered</span>
                  <span className="text-text-muted block text-xs">
                    Invitation accepted{' '}
                    {existing.data.usedAt === null
                      ? ''
                      : new Date(existing.data.usedAt).toLocaleString()}
                    . Their account is under Sellers.
                  </span>
                </div>
              </div>
            ) : (
              // Sent and still outstanding, or expired unaccepted.
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-text-bright flex items-center gap-1.5 text-sm">
                    Invitation sent
                    <StatusBadge
                      kind={existing.data.status === 'expired' ? 'failed' : 'pending'}
                      label={existing.data.status}
                    />
                  </div>
                  <div className="text-text-muted text-xs">
                    {new Date(existing.data.invitedAt).toLocaleString()} ·{' '}
                    {existing.data.status === 'expired' ? 'expired' : 'expires'}{' '}
                    {new Date(existing.data.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={resend.isPending}
                  onClick={() => void resendInvite()}
                >
                  <Send size={12} /> {resend.isPending ? 'Sending…' : 'Resend'}
                </Button>
              </div>
            )}

            {inviteUrl !== null && (
              <div className="mt-3">
                <div className="text-text-muted mb-1 text-xs">
                  The email is on its way. This link is shown once — only a hash of it is stored, so
                  it cannot be looked up later. Resending issues a new one and retires this.
                </div>
                <code className="text-text-body block overflow-x-auto rounded-lg bg-[var(--color-bg)] p-2 text-xs">
                  {inviteUrl}
                </code>
              </div>
            )}
          </div>
        )}

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!dirty || update.isPending || !canWrite}
          onClick={() => void save()}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
