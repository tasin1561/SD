'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { ScanLine } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { DateField } from '@skydrop/ui/app/date-field';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import './order-shipping.css';

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

  function submit(): void {
    record.mutate(
      {
        shipmentId,
        body: {
          status,
          eventAtIso: new Date(eventAt).toISOString(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
          ...(locationCity.trim() === '' ? {} : { locationCity: locationCity.trim() }),
          ...(isNdr && failureReason.trim() !== '' ? { failureReason: failureReason.trim() } : {}),
        },
      },
      { onSuccess: (r) => setResult(r) },
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon={<ScanLine size={14} />} onClick={() => setOpen(true)}>
        Record a scan manually
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        size="lg"
        icon={<ScanLine size={18} />}
        title="Record a courier scan"
        description="For when the courier's webhook never reached us. This drives the order exactly as a real scan would."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              {result === null ? 'Cancel' : 'Done'}
            </Button>
            {result === null && (
              <AsyncButton
                labels={{ idle: 'Record scan', busy: 'Recording…' }}
                state={record.isPending ? 'busy' : 'idle'}
                disabled={eventAt === ''}
                onClick={submit}
              />
            )}
          </DialogFooter>
        }
      >
        <div className="os-fields">
          <Select
            id="ms-status"
            label="What happened"
            hint="Only scans a courier can report are listed. RTO received is a warehouse action, not a scan."
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {SCAN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>

          <DateField
            id="ms-when"
            type="datetime-local"
            label="When it happened"
            hint="The time of the SCAN, not now. Backdating puts it in the right place in the customer's timeline."
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
          />

          <div className="os-fields" data-cols="2">
            <TextField
              id="ms-city"
              label="City"
              hint="Optional. Shown to the customer."
              value={locationCity}
              onChange={(e) => setLocationCity(e.target.value)}
            />
            {isNdr && (
              <TextField
                id="ms-fail"
                label="Why delivery failed"
                hint="Recorded as the NDR reason."
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                placeholder="Customer unreachable"
              />
            )}
          </div>

          <TextArea
            id="ms-desc"
            label="Description"
            hint="Optional. What the courier's panel said, so the next person can check it."
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {record.error !== null && (
            <p className="oo-error" role="alert">
              {serverVerdict(record.error)}
            </p>
          )}

          {result !== null && (
            <p
              className="os-result"
              data-ok={result.orderTransitioned ? '1' : undefined}
              role="status"
            >
              {result.orderTransitioned ? (
                <>Scan recorded and the order moved forward.</>
              ) : (
                <>
                  Scan recorded on the timeline. The order did not move
                  {result.skipReason === null || result.skipReason === undefined
                    ? ''
                    : ` — ${result.skipReason.replace(/_/g, ' ').toLowerCase()}`}
                  . That is normal when it is already at or past this point.
                </>
              )}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
