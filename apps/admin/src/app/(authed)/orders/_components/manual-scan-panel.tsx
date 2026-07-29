'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Record a courier scan by hand (TRK-9).
 *
 * This is the recovery path for when a webhook never arrives — the
 * courier's panel shows a parcel delivered and ours does not, so
 * somebody has to say so. It runs the SAME mapping and the same
 * monotonic-forward guard as a webhook scan, so it can move the order
 * exactly as far as a real scan would and no further; a backward or
 * duplicate entry is skipped rather than corrupting the timeline.
 *
 * The scan time is asked for explicitly and defaults to now only as a
 * convenience. TRK-3 stores it as the SCAN time, not the time you typed
 * it — so backdating a delivery that happened yesterday puts it in the
 * right place in the customer's timeline instead of at the end.
 *
 * Kept behind a button rather than sitting open: this writes a courier
 * event that we are asserting happened, and that is not a thing to do
 * by mis-clicking.
 */

/** What an operator is allowed to assert. Mirrors MANUAL_SCAN_STATUS_VALUES. */
const SCAN_STATUSES = [
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_ATTEMPTED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_DELIVERED',
  'LOST',
  'DAMAGED',
] as const;

interface ManualScanBody {
  status: string;
  eventAtIso: string;
  description?: string;
  locationName?: string;
  locationCity?: string;
  failureReason?: string;
}

interface ManualScanOutcome {
  trackingEventId: string;
  orderTransitioned: boolean;
  skipReason?: string | null;
}

function useRecordManualScan(): UseMutationResult<
  ManualScanOutcome,
  Error,
  { shipmentId: string; body: ManualScanBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, body }) =>
      client.request<ManualScanOutcome>(`/api/admin/tracking/shipments/${shipmentId}/manual-scan`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      // A scan can move the order, so the whole detail view is stale.
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    },
  });
}

/** `datetime-local` wants local time with no zone; this produces that. */
function nowForInput(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ManualScanPanel({ shipmentId }: { readonly shipmentId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const record = useRecordManualScan();
  const [status, setStatus] = useState<string>('IN_TRANSIT');
  const [eventAt, setEventAt] = useState(nowForInput);
  const [description, setDescription] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [result, setResult] = useState<ManualScanOutcome | null>(null);

  function close(): void {
    setOpen(false);
    setDescription('');
    setLocationCity('');
    setFailureReason('');
    setResult(null);
    record.reset();
  }

  const isNdr = status === 'DELIVERY_ATTEMPTED';

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Record a scan manually
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        size="lg"
        title="Record a courier scan"
        description="For when the courier's webhook never reached us. This drives the order exactly as a real scan would."
      >
        <FormField
          label="What happened"
          htmlFor="ms-status"
          hint="Only scans a courier can report are listed. RTO received is a warehouse action, not a scan."
        >
          <Select id="ms-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {SCAN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="When it happened"
          htmlFor="ms-when"
          hint="The time of the SCAN, not now. Backdating puts it in the right place in the customer's timeline."
        >
          <Input
            id="ms-when"
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
          />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="City" htmlFor="ms-city" hint="Optional. Shown to the customer.">
            <Input
              id="ms-city"
              value={locationCity}
              onChange={(e) => setLocationCity(e.target.value)}
            />
          </FormField>
          {isNdr && (
            <FormField
              label="Why delivery failed"
              htmlFor="ms-fail"
              hint="Recorded as the NDR reason."
            >
              <Input
                id="ms-fail"
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                placeholder="Customer unreachable"
              />
            </FormField>
          )}
        </div>

        <FormField
          label="Description"
          htmlFor="ms-desc"
          hint="Optional. What the courier's panel said, so the next person can check it."
        >
          <Textarea
            id="ms-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {record.error !== null && <ErrorNote message={serverVerdict(record.error)} />}

        {result !== null && (
          <p className="text-sm">
            {result.orderTransitioned ? (
              <span className="text-[var(--color-good)]">
                Scan recorded and the order moved forward.
              </span>
            ) : (
              <span className="text-text-muted">
                Scan recorded on the timeline. The order did not move
                {result.skipReason === null || result.skipReason === undefined
                  ? ''
                  : ` — ${result.skipReason.replace(/_/g, ' ').toLowerCase()}`}
                . That is normal when it is already at or past this point.
              </span>
            )}
          </p>
        )}

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {result === null ? 'Cancel' : 'Done'}
          </Button>
          {result === null && (
            <Button
              size="md"
              disabled={eventAt === '' || record.isPending}
              onClick={() =>
                record.mutate(
                  {
                    shipmentId,
                    body: {
                      status,
                      eventAtIso: new Date(eventAt).toISOString(),
                      ...(description.trim() === '' ? {} : { description: description.trim() }),
                      ...(locationCity.trim() === '' ? {} : { locationCity: locationCity.trim() }),
                      ...(isNdr && failureReason.trim() !== ''
                        ? { failureReason: failureReason.trim() }
                        : {}),
                    },
                  },
                  { onSuccess: (r) => setResult(r) },
                )
              }
            >
              {record.isPending ? 'Recording…' : 'Record scan'}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
}
