'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  FormField,
  Input,
  SkeletonRows,
  useToast,
} from '@skydrop/ui/components';
import { useChangeConsignee, useConsignee, useConsigneeHistory } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RaiseTicketModal } from '../../../tickets/_components/raise-ticket-modal';

/**
 * Correcting who the parcel is going to, while the courier still allows
 * it.
 *
 * ── WHY THE FIELDS GO GREY RATHER THAN VANISH ────────────────────────
 * A seller looking for "can I fix the phone number" needs to find the
 * answer, and a section that disappears once the parcel is on the van
 * reads as a feature that does not exist. Greyed out with the reason
 * says the thing that is actually true: it exists, and it is too late.
 *
 * ── WHY CITY AND PINCODE ARE SHOWN BUT NOT EDITABLE ──────────────────
 * They are what the parcel was routed on. Hiding them would invite the
 * question; showing them as fixed answers it.
 */
export function ConsigneePanel({ orderId }: { readonly orderId: string }): ReactElement {
  const toast = useToast();
  const info = useConsignee(orderId);
  const history = useConsigneeHistory(orderId);
  const change = useChangeConsignee();

  const [raising, setRaising] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  if (info.isLoading) return <SkeletonRows rows={3} cols={1} />;
  if (info.isError) {
    // An order with no parcel yet is not an error, it is Tuesday: the
    // shipment is provisioned when the order is CONFIRMED, so every
    // order before that point would otherwise show a red failure for
    // being at a perfectly normal stage of its life.
    const code = (info.error as { body?: { code?: string } } | undefined)?.body?.code;
    if (code === 'NO_LIVE_PARCEL') return <div />;
    return <ErrorNote message={serverVerdict(info.error)} retry={() => void info.refetch()} />;
  }
  const d = info.data;
  if (d === undefined) return <div />;

  const rows = history.data ?? [];
  // Only what the seller actually typed. An untouched field stays null
  // so it is not sent, rather than being re-sent unchanged.
  const dirty =
    (name !== null && name !== d.currentName) ||
    (phone !== null && phone !== d.currentPhone) ||
    (address !== null && address !== d.currentAddressLine1);

  const submit = (): void => {
    void (async () => {
      try {
        const r = await change.mutateAsync({
          orderId,
          ...(name !== null && name !== d.currentName ? { name } : {}),
          ...(phone !== null && phone !== d.currentPhone ? { phone } : {}),
          ...(address !== null && address !== d.currentAddressLine1
            ? { addressLine1: address }
            : {}),
        });
        setName(null);
        setPhone(null);
        setAddress(null);
        // Sent is not landed. Saying "changed" here would be a claim we
        // have not checked — the portal confirms it within the hour.
        if (r.accepted) {
          toast.success('Sent to the courier. We confirm it on their system shortly.');
        } else {
          toast.error(r.message ?? 'The courier would not take the change.');
        }
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <Card className="mt-4">
      <CardBody>
        <div className="mb-3">
          <h2 className="text-sm font-medium">Who this is going to</h2>
          {/*
            When the courier has stopped accepting changes, the reason is
            not a footnote — it is the whole answer, and it arrives at the
            moment somebody has spotted a wrong number and is about to fix
            it. So it is a warning with a way forward rather than grey
            text under a heading: the details cannot be corrected through
            the courier any more, but a person here can still ring them.
          */}
          {d.editable ? (
            <p className="text-text-muted mt-0.5 text-xs">{d.reason}</p>
          ) : (
            <div className="border-warning/40 bg-warning/10 mt-2 rounded-lg border p-3">
              <p className="text-text-bright text-sm font-medium">
                These can no longer be changed through the courier
              </p>
              <p className="text-text-body mt-1 text-sm">{d.reason}</p>
              <p className="text-text-muted mt-1 text-xs">
                If something here is wrong, tell us and we will take it up with them directly —
                sometimes they can still reach the driver.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => setRaising(true)}
              >
                Raise an issue
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="cons-name">
            <Input
              id="cons-name"
              value={name ?? d.currentName}
              disabled={!d.editable}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Phone" htmlFor="cons-phone">
            <Input
              id="cons-phone"
              value={phone ?? d.currentPhone}
              disabled={!d.editable}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Address"
          htmlFor="cons-address"
          hint="The street address only — see below for why the rest cannot move."
        >
          <Input
            id="cons-address"
            value={address ?? d.currentAddressLine1}
            disabled={!d.editable}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>

        <p className="text-text-muted mt-2 text-xs">
          {d.city} · {d.stateProvince} · {d.postalCode} — fixed. The parcel is already sorted and
          routed on this pincode, so it cannot be sent somewhere else; only the street address can
          be corrected.
        </p>

        {d.editable ? (
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || change.isPending}
              onClick={submit}
            >
              {change.isPending ? 'Sending…' : 'Send to the courier'}
            </Button>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="border-border mt-4 border-t pt-3">
            <p className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
              Changes made
            </p>
            <ol className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="text-text-muted mr-2 text-xs tabular-nums">
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {[
                    r.nameBefore !== null ? `name: ${r.nameBefore} → ${r.nameAfter}` : null,
                    r.phoneBefore !== null ? `phone: ${r.phoneBefore} → ${r.phoneAfter}` : null,
                    r.addressBefore !== null
                      ? `address: ${r.addressBefore} → ${r.addressAfter}`
                      : null,
                  ]
                    .filter((x) => x !== null)
                    .join(' · ')}
                  <span className="ml-2 text-xs">
                    {r.courierAcceptedAt === null ? (
                      <span className="text-danger">the courier did not take it</span>
                    ) : r.verifiedAt === null ? (
                      <span className="text-text-muted">sent — confirming</span>
                    ) : r.verifiedMatch === true ? (
                      <span className="text-success">confirmed on their system</span>
                    ) : (
                      <span className="text-danger">
                        their system still shows the old value — we are on it
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardBody>

      {/* The order is already known, so it is not asked for again. */}
      <RaiseTicketModal open={raising} onOpenChange={setRaising} orderId={orderId} />
    </Card>
  );
}
