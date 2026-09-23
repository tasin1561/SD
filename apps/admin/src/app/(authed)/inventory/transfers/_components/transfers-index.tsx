'use client';

import { useState, type ReactElement } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { useWarehouseOptions } from '@/lib/ops-hooks';
import { useCreateTransfer } from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  Actions,
  AreaPage,
  AreaSection,
  Callout,
  FieldGrid,
  InlineError,
  Panel,
  mutationPhase,
} from '../../_components/stock-kit';

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
  // A transfer moves real stock between buildings, so it is confirmed
  // first (owner). The request it sends is unchanged.
  const [confirming, setConfirming] = useState(false);

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

  function submit(): void {
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
        // `reason`, not `description` — CreateStockTransferDto declares
        // reason, so the old key 400'd when filled and was silently
        // dropped when blank, losing the note either way.
        ...(form.description.trim() === '' ? {} : { reason: form.description.trim() }),
      },
      { onSuccess: () => setDone(true) },
    );
  }

  const sourceName =
    (warehouses.data ?? []).find((w) => w.id === form.sourceWarehouseId)?.name ?? '—';
  const destName = (warehouses.data ?? []).find((w) => w.id === form.destWarehouseId)?.name ?? '—';

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Transfers' }]}
        title="Inter-warehouse transfer"
        subtitle="Moves units out of one warehouse and into another as a matched pair of movements."
      />

      <Panel title="What is moving">
        <FieldGrid columns={3}>
          <TextField
            id="tr-seller"
            label="Seller id"
            inputClassName="sk-ident"
            value={form.sellerId}
            onChange={(e) => set('sellerId', e.target.value)}
          />
          <TextField
            id="tr-variant"
            label="Variant id"
            inputClassName="sk-ident"
            value={form.variantId}
            onChange={(e) => set('variantId', e.target.value)}
          />
          <TextField
            id="tr-qty"
            label="Quantity"
            hint="Whole units, at least one."
            type="number"
            min={1}
            inputClassName="sk-figure"
            value={form.qty}
            onChange={(e) => set('qty', e.target.value)}
          />
        </FieldGrid>
      </Panel>

      <AreaSection title="From" note="The exact bin and batch the units leave.">
        <Panel>
          <FieldGrid columns={3}>
            <Select
              id="tr-src-wh"
              label="Warehouse"
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
            <TextField
              id="tr-src-bin"
              label="Bin id"
              inputClassName="sk-ident"
              value={form.sourceBinId}
              onChange={(e) => set('sourceBinId', e.target.value)}
            />
            <TextField
              id="tr-src-batch"
              label="Batch id"
              inputClassName="sk-ident"
              value={form.sourceBatchId}
              onChange={(e) => set('sourceBatchId', e.target.value)}
            />
          </FieldGrid>
        </Panel>
      </AreaSection>

      <AreaSection
        title="To"
        note="The destination batch is required, not created for you — it carries expiry, unit cost and the goods-receipt link that FEFO and margin depend on."
      >
        <Panel>
          <FieldGrid columns={3}>
            <Select
              id="tr-dst-wh"
              label="Warehouse"
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
            <TextField
              id="tr-dst-bin"
              label="Bin id"
              inputClassName="sk-ident"
              value={form.destBinId}
              onChange={(e) => set('destBinId', e.target.value)}
            />
            <TextField
              id="tr-dst-batch"
              label="Batch id"
              inputClassName="sk-ident"
              value={form.destBatchId}
              onChange={(e) => set('destBatchId', e.target.value)}
            />
          </FieldGrid>
          <TextField
            id="tr-desc"
            label="Note"
            hint="Optional. Why this move happened."
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Panel>
      </AreaSection>

      {sameWarehouse && (
        <InlineError message="Source and destination are the same warehouse — that is a bin move, not a transfer." />
      )}
      {create.error !== null && <InlineError message={serverVerdict(create.error)} />}
      {done && (
        <Callout tone="good">
          Transfer recorded. It appears in the movement ledger as a TRANSFER_OUT and a TRANSFER_IN.
        </Callout>
      )}

      <Actions>
        <AsyncButton
          size="md"
          icon={<ArrowRightLeft size={16} />}
          state={mutationPhase(create)}
          labels={{ idle: 'Transfer stock', busy: 'Transferring…' }}
          disabled={!complete || sameWarehouse || create.isPending}
          onClick={() => setConfirming(true)}
        />
      </Actions>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Transfer this stock?"
        entity={`${form.variantId.trim()} · seller ${form.sellerId.trim()}`}
        entityIsIdentifier
        amount={`${form.qty} unit(s) · ${sourceName} → ${destName}`}
        consequence="The units leave the source bin and batch and arrive in the destination bin and batch as a matched TRANSFER_OUT and TRANSFER_IN — a movement, not something this form can take back."
        confirmLabel="Transfer stock"
        onConfirm={submit}
      />
    </AreaPage>
  );
}
