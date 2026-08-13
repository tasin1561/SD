'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useCreateAdjustment } from '@/lib/inventory-hooks';

/**
 * Raising a stock correction.
 *
 * ── WHY THIS WAS MISSING AND WHY IT MATTERED ─────────────────────────
 * INV-8 routes anything above the value threshold to PENDING and waits
 * for a second person. That approval queue shipped with a reader and no
 * writer: it could never receive a row, above-threshold stock could not
 * be corrected through any interface, and
 * `inventory.adjustments.create` was a permission nobody could use.
 *
 * ── THE GRAIN IS (VARIANT, BIN, BATCH) ───────────────────────────────
 * Stock is held per variant per bin per batch, so an adjustment naming
 * only a SKU cannot be applied to anything. The ids are typed rather
 * than picked from dropdowns because the operator raising one is reading
 * them off a count sheet or the movements report — and a picker over
 * every bin × batch in a warehouse is a worse way to find the one line
 * you already know.
 *
 * ── SIGN AND TYPE ARE BOTH ASKED FOR ─────────────────────────────────
 * `type` says INCREASE or DECREASE and `qtyChange` is signed. The server
 * checks the two agree rather than inferring one from the other, so this
 * form derives the sign from the type: an operator who types "-5" on a
 * DECREASE means the same thing as "5", and guessing wrong moves stock
 * the wrong way.
 */
const REASON_CODES = [
  'COUNTING_ERROR',
  'DAMAGED_IN_WAREHOUSE',
  'DAMAGED_ON_ARRIVAL',
  'LOST',
  'FOUND_EXTRA',
  'EXPIRED',
  'RECALLED',
  'OTHER',
] as const;

export function NewAdjustmentPanel(): ReactElement | null {
  const toast = useToast();
  const mayCreate = usePermission('inventory.adjustments.create');
  const create = useCreateAdjustment();

  const [open, setOpen] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [type, setType] = useState<'INCREASE' | 'DECREASE'>('DECREASE');
  const [reasonCode, setReasonCode] = useState<string>('COUNTING_ERROR');
  const [description, setDescription] = useState('');
  const [variantId, setVariantId] = useState('');
  const [binId, setBinId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!mayCreate) return null;

  function reset(): void {
    setSellerId('');
    setType('DECREASE');
    setReasonCode('COUNTING_ERROR');
    setDescription('');
    setVariantId('');
    setBinId('');
    setBatchId('');
    setQty('');
    setError(null);
  }

  const qtyNum = Math.abs(Number(qty));
  const qtyValid = qty.trim() !== '' && Number.isInteger(qtyNum) && qtyNum > 0;
  const complete =
    sellerId.trim() !== '' &&
    variantId.trim() !== '' &&
    binId.trim() !== '' &&
    batchId.trim() !== '' &&
    qtyValid;

  async function onSubmit(): Promise<void> {
    setError(null);
    try {
      // Sign derived from the type, never from what was typed — the
      // server rejects a mismatch, and an operator typing "-5" on a
      // DECREASE means the same as "5".
      const signed = type === 'DECREASE' ? -qtyNum : qtyNum;
      const result = await create.mutateAsync({
        sellerId: sellerId.trim(),
        type,
        reasonCode,
        ...(description.trim() ? { description: description.trim() } : {}),
        lines: [
          {
            variantId: variantId.trim(),
            binId: binId.trim(),
            batchId: batchId.trim(),
            qtyChange: signed,
          },
        ],
      });
      setOpen(false);
      reset();
      // The server decides whether this applied or queued (INV-8's
      // threshold). Reporting which is the whole point — "saved" would
      // leave the operator not knowing if stock moved.
      toast.success(
        result.status === 'PENDING'
          ? 'Raised — waiting for approval before it moves any stock.'
          : `Applied — stock adjusted (${result.status}).`,
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        New adjustment
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            reset();
          }
        }}
        title="Raise a stock adjustment"
      >
        <p className="text-text-muted mb-3 text-sm">
          Corrects counted stock for one batch in one bin. Below the value threshold it applies
          straight away; above it, it waits here for a second person.
        </p>

        {error !== null && (
          <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical mb-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <FormField label="Seller id" required>
            <Input value={sellerId} onChange={(e) => setSellerId(e.target.value)} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Direction" required>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as 'INCREASE' | 'DECREASE')}
              >
                <option value="DECREASE">Remove stock</option>
                <option value="INCREASE">Add stock</option>
              </Select>
            </FormField>
            <FormField label="Quantity" required hint="How many units, unsigned.">
              <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Reason" required>
            <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </FormField>

          <Card>
            <CardBody>
              <p className="text-text-faint mb-2 text-xs">
                Stock is held per batch per bin, so all three are needed — read them off the count
                sheet or the movements report.
              </p>
              <div className="space-y-3">
                <FormField label="Variant id" required>
                  <Input value={variantId} onChange={(e) => setVariantId(e.target.value)} />
                </FormField>
                <FormField label="Bin id" required>
                  <Input value={binId} onChange={(e) => setBinId(e.target.value)} />
                </FormField>
                <FormField label="Batch id" required>
                  <Input value={batchId} onChange={(e) => setBatchId(e.target.value)} />
                </FormField>
              </div>
            </CardBody>
          </Card>

          <FormField
            label="What happened"
            hint="Kept on the adjustment. The approver reads this and nothing else."
          >
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </FormField>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!complete || create.isPending}
            onClick={() => void onSubmit()}
          >
            {create.isPending ? 'Raising…' : 'Raise adjustment'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
