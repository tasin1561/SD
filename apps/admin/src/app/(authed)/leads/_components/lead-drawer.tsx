'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Check, Mail, Phone, Send, UserRound } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import {
  AcAlert,
  AcCallout,
  AcDl,
  AcFact,
  AcRevealValue,
  phaseOf,
} from '../../settings/_components/ac-parts';
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={lead.companyName}
      icon={<UserRound size={18} />}
      size="lg"
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            state={phaseOf(update.isPending, error)}
            labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
            disabled={!dirty || update.isPending || !canWrite}
            onClick={() => void save()}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <div className="ac-meta">
          <StatusChip
            kind={inviteLeadStatusKind(lead.status as InviteLeadStatus)}
            label={lead.status.toLowerCase()}
            size="sm"
          />
          {lead.submissionCount > 1 && <AcFact tone="warn">asked {lead.submissionCount}×</AcFact>}
          {direction?.unserved === true && (
            <AcFact tone="bad">{direction.label} — we do not run this corridor</AcFact>
          )}
        </div>

        {/* Contact first, and one click each. Whoever opens this is about
            to get in touch; making them select-and-copy a phone number
            is the difference between a queue worked and a queue skimmed. */}
        <div className="ac-buttons" data-align="start">
          <a href={`mailto:${lead.email}`} className="ac-link ac-inline">
            <Mail size={14} aria-hidden /> {lead.email}
          </a>
          <a href={`tel:${lead.phone.replace(/\s+/g, '')}`} className="ac-link ac-inline">
            <Phone size={14} aria-hidden /> <span className="sk-figure">{lead.phone}</span>
          </a>
          {lead.altPhone !== null && lead.altPhone !== '' && (
            <a href={`tel:${lead.altPhone.replace(/\s+/g, '')}`} className="ac-link ac-inline">
              <Phone size={14} aria-hidden /> <span className="sk-figure">{lead.altPhone}</span>
            </a>
          )}
        </div>

        <AcDl
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
          <div className="ac-card__body">
            <span className="ac-label">What they wrote</span>
            <p className="ac-quote">{lead.message}</p>
          </div>
        )}

        <Select
          label="Status"
          id="lead-status"
          hint={STATUS_COPY[status]}
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
        >
          {Object.keys(STATUS_COPY).map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>

        <TextArea
          label="Internal notes"
          id="lead-notes"
          hint="Never shown to the lead. What was said, what they need, when to call back."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />

        {canInvite && (
          <div className="ac-card">
            {existing.data === undefined ? (
              <p className="ac-muted">Checking for an invitation…</p>
            ) : existing.data === null ? (
              // Nobody has invited them yet.
              <div className="ac-card__head">
                <div className="ac-card__titles">
                  <span className="ac-strong">Invite them to register</span>
                  <span className="ac-muted">Sends a registration link to {lead.email}.</span>
                </div>
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  icon={<Send size={14} />}
                  state={invite.isPending ? 'busy' : 'idle'}
                  labels={{ idle: 'Send invite', busy: 'Sending…' }}
                  onClick={() => void sendInvite()}
                />
              </div>
            ) : existing.data.status === 'used' ? (
              // They accepted it. There is nothing to resend, and the
              // account exists — offering a button here would be an
              // invitation to break something.
              <AcCallout tone="good" icon={<Check size={15} />} title="They registered">
                <span className="ac-muted">
                  Invitation accepted{' '}
                  {existing.data.usedAt === null
                    ? ''
                    : new Date(existing.data.usedAt).toLocaleString()}
                  . Their account is under Sellers.
                </span>
              </AcCallout>
            ) : (
              // Sent and still outstanding, or expired unaccepted.
              <div className="ac-card__head">
                <div className="ac-card__titles">
                  <span className="ac-inline ac-strong">
                    Invitation sent
                    <StatusChip
                      kind={existing.data.status === 'expired' ? 'failed' : 'pending'}
                      label={existing.data.status}
                      size="sm"
                    />
                  </span>
                  <span className="ac-muted">
                    {new Date(existing.data.invitedAt).toLocaleString()} ·{' '}
                    {existing.data.status === 'expired' ? 'expired' : 'expires'}{' '}
                    {new Date(existing.data.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  icon={<Send size={14} />}
                  state={resend.isPending ? 'busy' : 'idle'}
                  labels={{ idle: 'Resend', busy: 'Sending…' }}
                  onClick={() => void resendInvite()}
                />
              </div>
            )}

            {inviteUrl !== null && (
              <div className="ac-card__body">
                <p className="ac-muted">
                  The email is on its way. This link is shown once — only a hash of it is stored, so
                  it cannot be looked up later. Resending issues a new one and retires this.
                </p>
                <AcRevealValue value={inviteUrl} label="Invitation link" />
              </div>
            )}
          </div>
        )}

        {error !== null && <AcAlert message={error} />}
      </div>
    </Dialog>
  );
}
