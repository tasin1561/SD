'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Mail, Phone } from 'lucide-react';
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
  useUpdateInviteLead,
  type InviteLead,
  type InviteLeadStatus as LeadStatus,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
  const toast = useToast();
  const update = useUpdateInviteLead();
  const [status, setStatus] = useState<LeadStatus>('NEW');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever a different lead is opened — otherwise the previous
  // lead's notes appear under this one's name, which is the kind of
  // mistake that ends up in a customer conversation.
  useEffect(() => {
    if (lead === null) return;
    setStatus(lead.status);
    setNotes(lead.notes ?? '');
    setError(null);
  }, [lead]);

  if (lead === null) return <></>;

  const dirty = status !== lead.status || notes !== (lead.notes ?? '');
  const direction = lead.shippingDirection === null ? null : DIRECTION[lead.shippingDirection];

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

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!dirty || update.isPending}
          onClick={() => void save()}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
