'use client';

import { useState, type ReactElement } from 'react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { CalendarPlus, ClipboardCheck, ListChecks, TriangleAlert } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useWarehouseOptions } from '@/lib/ops-hooks';
import {
  useCompleteCycleCount,
  useCreateCycleCount,
  useCycleCountsList,
  useRecordCycleCountItems,
  useStartCycleCount,
  type CycleCountView,
} from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AreaPage,
  AreaSection,
  Facts,
  FieldGrid,
  InlineError,
  KpiGrid,
  Panel,
  PanelPad,
  Stack,
  ToneText,
  Toolbar,
  mutationPhase,
} from '../../_components/stock-kit';

const PAGE_SIZE = 25;
const COUNT_TYPES = ['FULL', 'ZONE', 'SAMPLE', 'SKU_TARGETED', 'ABC_CLASSIFICATION'] as const;

/**
 * Cycle counts — physical stock verification.
 *
 * The lifecycle is schedule → start → record what you actually found →
 * complete. Completing is the consequential step: it turns every
 * difference between counted and system quantity into a stock
 * adjustment, which then follows the ordinary INV-8 threshold rules. So
 * the button says that, and the discrepancy count is on screen before
 * you press it.
 */
export function CycleCountsIndex(): ReactElement {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useCycleCountsList({
    ...(status === '' ? {} : { status }),
    page,
    pageSize: PAGE_SIZE,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const open = items.find((c) => c.id === openId) ?? null;

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Cycle counts' }]}
        title="Cycle counts"
        subtitle="Physical verification against what the system believes. Completing a count raises an adjustment for every difference."
        action={
          <Button icon={<CalendarPlus size={16} />} onClick={() => setCreating(true)}>
            Schedule a count
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="Counts shown" icon={<ListChecks size={14} />} value={items.length} />
        <KpiCard
          label="In progress"
          icon={<ClipboardCheck size={14} />}
          value={items.filter((c) => c.status === 'IN_PROGRESS').length}
        />
        <KpiCard
          label="Discrepancies found"
          icon={<TriangleAlert size={14} />}
          hint="Across the counts on this page"
          value={items.reduce((n, c) => n + (c.discrepancyCount ?? 0), 0)}
        />
      </KpiGrid>

      <Stack>
        <Toolbar>
          <Select
            id="cc-status"
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Toolbar>

        {list.isLoading ? (
          <SkeletonRows rows={5} cols={8} />
        ) : list.isError ? (
          <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No cycle counts"
            description="Schedule one to reconcile a warehouse, a zone, or a handful of SKUs against the system."
            action={<Button onClick={() => setCreating(true)}>Schedule a count</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Warehouse</Th>
                  <Th align="right">Items</Th>
                  <Th align="right">Discrepancies</Th>
                  <Th align="right">Value</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((c) => (
                  <Tr key={c.id}>
                    <Td className="sk-figure stk-nowrap">
                      {new Date(c.countDate).toLocaleDateString('en-IN')}
                    </Td>
                    <Td>{c.countType.replace(/_/g, ' ').toLowerCase()}</Td>
                    <Td>
                      <Ident value={c.warehouseId} />
                    </Td>
                    <Td align="right" className="sk-figure">
                      <Num value={c.items.length} />
                    </Td>
                    <Td align="right" className="sk-figure">
                      <Num value={c.discrepancyCount ?? 0} />
                    </Td>
                    <Td align="right">
                      <Money amount={c.totalDiscrepancyValueInr ?? 0} />
                    </Td>
                    <Td>
                      <StatusChip size="sm" kind={countKind(c.status)} label={pretty(c.status)} />
                    </Td>
                    <Td align="right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenId(c.id)}>
                        Open
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <PanelPad>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </PanelPad>
          </>
        )}
      </Stack>

      <ScheduleCount open={creating} onClose={() => setCreating(false)} />
      <CountDetail count={open} onClose={() => setOpenId(null)} />
    </AreaPage>
  );
}

function pretty(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase();
}

function countKind(status: string): 'draft' | 'pending' | 'delivered' | 'cancelled' {
  switch (status) {
    case 'SCHEDULED':
      return 'draft';
    case 'IN_PROGRESS':
      return 'pending';
    case 'COMPLETED':
      return 'delivered';
    default:
      return 'cancelled';
  }
}

function ScheduleCount({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const warehouses = useWarehouseOptions();
  const [warehouseId, setWarehouseId] = useState('');
  const [countType, setCountType] = useState<string>('FULL');
  const [countDate, setCountDate] = useState(() => new Date().toISOString().slice(0, 10));
  const create = useCreateCycleCount();

  function close(): void {
    create.reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Schedule a cycle count"
      description="Creates it as SCHEDULED. Nothing is counted or changed until someone starts it."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            size="md"
            state={mutationPhase(create)}
            labels={{ idle: 'Schedule', busy: 'Scheduling…' }}
            disabled={warehouseId === '' || create.isPending}
            onClick={() =>
              create.mutate(
                { warehouseId, countType, countDate: new Date(countDate).toISOString() },
                { onSuccess: close },
              )
            }
          />
        </DialogFooter>
      }
    >
      <Stack>
        <Select
          id="cc-wh"
          label="Warehouse"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">Select a warehouse…</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </Select>

        <Select
          id="cc-type"
          label="Scope"
          hint="What the counters are being asked to walk."
          value={countType}
          onChange={(e) => setCountType(e.target.value)}
        >
          {COUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>

        <TextField
          id="cc-date"
          label="Count date"
          type="date"
          floatLabel
          value={countDate}
          onChange={(e) => setCountDate(e.target.value)}
        />

        {create.error !== null && <InlineError message={serverVerdict(create.error)} />}
      </Stack>
    </Dialog>
  );
}

/**
 * One count: start it, record what was on the shelf, then complete.
 *
 * The item form takes one line at a time on purpose. A bulk paste would
 * be faster to build and worse to use — a counter reads one bin, types
 * one number, and wants to see it land before moving on.
 */
function CountDetail({
  count,
  onClose,
}: {
  count: CycleCountView | null;
  onClose: () => void;
}): ReactElement {
  const start = useStartCycleCount();
  const record = useRecordCycleCountItems();
  const complete = useCompleteCycleCount();

  const [variantId, setVariantId] = useState('');
  const [binId, setBinId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [notes, setNotes] = useState('');

  const error = start.error ?? record.error ?? complete.error;
  const inProgress = count?.status === 'IN_PROGRESS';
  const scheduled = count?.status === 'SCHEDULED';

  function clearLine(): void {
    setVariantId('');
    setBinId('');
    setBatchId('');
    setCountedQty('');
    setNotes('');
  }

  function close(): void {
    clearLine();
    start.reset();
    record.reset();
    complete.reset();
    onClose();
  }

  const discrepancies = (count?.items ?? []).filter((i) => i.countedQty !== i.systemQty);

  return (
    <Dialog
      open={count !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Cycle count"
      description={
        count === null ? undefined : (
          <span className="adj-sub">
            <StatusChip size="sm" kind={countKind(count.status)} label={pretty(count.status)} />
            <span className="stk-faint">
              {count.countType.replace(/_/g, ' ').toLowerCase()} ·{' '}
              {new Date(count.countDate).toLocaleDateString('en-IN')}
            </span>
          </span>
        )
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Close
          </Button>
          {count !== null && scheduled && (
            <AsyncButton
              size="md"
              state={mutationPhase(start)}
              labels={{ idle: 'Start counting', busy: 'Starting…' }}
              disabled={start.isPending}
              onClick={() => start.mutate({ id: count.id })}
            />
          )}
          {count !== null && inProgress && (
            <AsyncButton
              size="md"
              state={mutationPhase(complete)}
              labels={{
                idle:
                  discrepancies.length === 0
                    ? 'Complete — no adjustments'
                    : `Complete — raises ${discrepancies.length} adjustment${discrepancies.length === 1 ? '' : 's'}`,
                busy: 'Completing…',
              }}
              disabled={complete.isPending}
              onClick={() => complete.mutate({ id: count.id }, { onSuccess: close })}
            />
          )}
        </DialogFooter>
      }
    >
      {count !== null && (
        <Stack>
          <Facts
            columns={4}
            items={[
              { label: 'Warehouse', value: <Ident value={count.warehouseId} /> },
              {
                label: 'Zone',
                value: count.zoneId === null ? 'Whole warehouse' : <Ident value={count.zoneId} />,
              },
              {
                label: 'Started',
                value: count.startedAt === null ? '—' : new Date(count.startedAt).toLocaleString(),
              },
              {
                label: 'Completed',
                value:
                  count.completedAt === null ? '—' : new Date(count.completedAt).toLocaleString(),
              },
            ]}
          />

          {inProgress && (
            <AreaSection
              title="Record a counted line"
              note="System quantity is snapshotted when you record, not when the count was scheduled."
            >
              <Panel>
                <FieldGrid columns={2}>
                  <TextField
                    id="cc-variant"
                    label="Variant id"
                    inputClassName="sk-ident"
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                    placeholder="uuid"
                  />
                  <TextField
                    id="cc-qty"
                    label="Counted quantity"
                    type="number"
                    min={0}
                    inputClassName="sk-figure"
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                  />
                  <TextField
                    id="cc-bin"
                    label="Bin id"
                    hint="Required — a count is per bin and batch"
                    inputClassName="sk-ident"
                    value={binId}
                    onChange={(e) => setBinId(e.target.value)}
                  />
                  <TextField
                    id="cc-batch"
                    label="Batch id"
                    hint="Required — a count is per bin and batch"
                    inputClassName="sk-ident"
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                  />
                </FieldGrid>
                <TextArea
                  id="cc-notes"
                  label="Notes"
                  hint="Required — a count is per bin and batch"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the number alone will not explain."
                />
                <div className="stk-actions">
                  <AsyncButton
                    size="md"
                    state={mutationPhase(record)}
                    labels={{ idle: 'Record line', busy: 'Recording…' }}
                    disabled={
                      variantId.trim() === '' ||
                      countedQty === '' ||
                      // Both are REQUIRED server-side; without this the operator
                      // types a count, clicks, and gets a 400 for a field the
                      // form told them was optional.
                      binId.trim() === '' ||
                      batchId.trim() === '' ||
                      record.isPending
                    }
                    onClick={() =>
                      record.mutate(
                        {
                          id: count.id,
                          items: [
                            {
                              variantId: variantId.trim(),
                              countedQty: Number(countedQty),
                              // Sent unconditionally: RecordCountItemDto requires
                              // both, because systemQty is held per bin+batch.
                              // Omitting them 400'd the whole line.
                              binId: binId.trim(),
                              batchId: batchId.trim(),
                              ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
                            },
                          ],
                        },
                        { onSuccess: clearLine },
                      )
                    }
                  />
                </div>
              </Panel>
            </AreaSection>
          )}

          <AreaSection
            title={`Counted lines (${count.items.length})`}
            note={
              discrepancies.length === 0
                ? 'Every line matches the system.'
                : `${discrepancies.length} differ from the system — completing will raise an adjustment for each.`
            }
          >
            {count.items.length === 0 ? (
              <EmptyState
                bare
                title="Nothing counted yet"
                description={
                  scheduled
                    ? 'Start the count before recording lines.'
                    : 'Record the first line above.'
                }
              />
            ) : (
              <Panel flush>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Variant</Th>
                      <Th>Bin</Th>
                      <Th align="right">System</Th>
                      <Th align="right">Counted</Th>
                      <Th align="right">Difference</Th>
                      <Th>Notes</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {count.items.map((i) => {
                      const diff = i.countedQty - i.systemQty;
                      return (
                        <Tr key={i.id}>
                          <Td>
                            <Ident value={i.variantId} />
                          </Td>
                          <Td>{i.binId === null ? '—' : <Ident value={i.binId} />}</Td>
                          <Td align="right" className="sk-figure">
                            <Num value={i.systemQty} />
                          </Td>
                          <Td align="right" className="sk-figure">
                            <Num value={i.countedQty} />
                          </Td>
                          <Td align="right" className="sk-figure">
                            {diff === 0 ? (
                              <ToneText tone="faint">—</ToneText>
                            ) : diff < 0 ? (
                              <ToneText tone="bad">{diff}</ToneText>
                            ) : (
                              <span>+{diff}</span>
                            )}
                          </Td>
                          <Td>{i.notes ?? '—'}</Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </Panel>
            )}
          </AreaSection>

          {error !== null && error !== undefined && <InlineError message={serverVerdict(error)} />}
        </Stack>
      )}
    </Dialog>
  );
}
