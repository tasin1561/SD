'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  PageHeader,
  Section,
  Select,
} from '@skydrop/ui/components';
import { useWarehouseOptions } from '@/lib/ops-hooks';
import { useCreateTransfer } from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Move stock between warehouses.
 *
 * The destination batch is a required field rather than something we
 * create for you, and that is the whole reason this form looks the way
 * it does. Batches are warehouse-scoped and carry expiry, unit cost and
 * the goods-receipt link; auto-creating one at the destination would
 * quietly drop all three, so FEFO picking would order wrongly and
 * margin would be computed against nothing. Making the operator name a
 * batch forces the lineage question to be answered by someone who knows
 * the answer.
 *
 * There is no transfer LIST because the API has no read endpoint — a
 * transfer is a pair of movements, so the record of one is in the
 * movement ledger. The link below goes there rather than inventing a
 * second version of the truth.
 */
export function TransfersIndex(): ReactElement {
  const warehouses = useWarehouseOptions();
  const create = useCreateTransfer();
  const [form, setForm] = useState({
    sellerId: '',
    variantId: '',
    qty: '',
    sourceWarehouseId: '',
    sourceBinId: '',
    sourceBatchId: '',
    destWarehouseId: '',
    destBinId: '',
    destBatchId: '',
    description: '',
  });
  const [done, setDone] = useState(false);

  function set(key: keyof typeof form, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setDone(false);
  }

  const required: Array<keyof typeof form> = [
    'sellerId',
    'variantId',
    'qty',
    'sourceWarehouseId',
    'sourceBinId',
    'sourceBatchId',
    'destWarehouseId',
    'destBinId',
    'destBatchId',
  ];
  const complete = required.every((k) => form[k].trim() !== '') && Number(form.qty) > 0;
  const sameWarehouse =
    form.sourceWarehouseId !== '' && form.sourceWarehouseId === form.destWarehouseId;

  return (
    <div>
      <PageHeader
        title="Inter-warehouse transfer"
        subtitle="Moves units out of one warehouse and into another as a matched pair of movements."
      />

      <Card>
        <CardHeader title="What is moving" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Seller id" htmlFor="tr-seller">
              <Input
                id="tr-seller"
                value={form.sellerId}
                onChange={(e) => set('sellerId', e.target.value)}
              />
            </FormField>
            <FormField label="Variant id" htmlFor="tr-variant">
              <Input
                id="tr-variant"
                value={form.variantId}
                onChange={(e) => set('variantId', e.target.value)}
              />
            </FormField>
            <FormField label="Quantity" htmlFor="tr-qty" hint="Whole units, at least one.">
              <Input
                id="tr-qty"
                type="number"
                min={1}
                value={form.qty}
                onChange={(e) => set('qty', e.target.value)}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Section title="From" subtitle="The exact bin and batch the units leave.">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Warehouse" htmlFor="tr-src-wh">
            <Select
              id="tr-src-wh"
              value={form.sourceWarehouseId}
              onChange={(e) => set('sourceWarehouseId', e.target.value)}
            >
              <option value="">Select…</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Bin id" htmlFor="tr-src-bin">
            <Input
              id="tr-src-bin"
              value={form.sourceBinId}
              onChange={(e) => set('sourceBinId', e.target.value)}
            />
          </FormField>
          <FormField label="Batch id" htmlFor="tr-src-batch">
            <Input
              id="tr-src-batch"
              value={form.sourceBatchId}
              onChange={(e) => set('sourceBatchId', e.target.value)}
            />
          </FormField>
        </div>
      </Section>

      <Section
        title="To"
        subtitle="The destination batch is required, not created for you — it carries expiry, unit cost and the goods-receipt link that FEFO and margin depend on."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Warehouse" htmlFor="tr-dst-wh">
            <Select
              id="tr-dst-wh"
              value={form.destWarehouseId}
              onChange={(e) => set('destWarehouseId', e.target.value)}
            >
              <option value="">Select…</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Bin id" htmlFor="tr-dst-bin">
            <Input
              id="tr-dst-bin"
              value={form.destBinId}
              onChange={(e) => set('destBinId', e.target.value)}
            />
          </FormField>
          <FormField label="Batch id" htmlFor="tr-dst-batch">
            <Input
              id="tr-dst-batch"
              value={form.destBatchId}
              onChange={(e) => set('destBatchId', e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Note" htmlFor="tr-desc" hint="Optional. Why this move happened.">
          <Input
            id="tr-desc"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>
      </Section>

      {sameWarehouse && (
        <ErrorNote message="Source and destination are the same warehouse — that is a bin move, not a transfer." />
      )}
      {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}
      {done && (
        <p className="text-[var(--color-good)] text-sm">
          Transfer recorded. It appears in the movement ledger as a TRANSFER_OUT and a TRANSFER_IN.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          size="md"
          disabled={!complete || sameWarehouse || create.isPending}
          onClick={() =>
            create.mutate(
              {
                sellerId: form.sellerId.trim(),
                variantId: form.variantId.trim(),
                qty: Number(form.qty),
                sourceWarehouseId: form.sourceWarehouseId,
                sourceBinId: form.sourceBinId.trim(),
                sourceBatchId: form.sourceBatchId.trim(),
                destWarehouseId: form.destWarehouseId,
                destBinId: form.destBinId.trim(),
                destBatchId: form.destBatchId.trim(),
                ...(form.description.trim() === '' ? {} : { description: form.description.trim() }),
              },
              { onSuccess: () => setDone(true) },
            )
          }
        >
          {create.isPending ? 'Transferring…' : 'Transfer stock'}
        </Button>
      </div>
    </div>
  );
}
