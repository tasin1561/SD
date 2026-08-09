'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Money,
  Num,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Textarea,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        title="Cycle counts"
        subtitle="Physical verification against what the system believes. Completing a count raises an adjustment for every difference."
        action={<Button onClick={() => setCreating(true)}>Schedule a count</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Counts shown" value={<Num value={items.length} />} />
        <Stat
          label="In progress"
          value={<Num value={items.filter((c) => c.status === 'IN_PROGRESS').length} />}
        />
        <Stat
          label="Discrepancies found"
          hint="Across the counts on this page"
          value={<Num value={items.reduce((n, c) => n + (c.discrepancyCount ?? 0), 0)} />}
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="cc-status">
          Status
        </label>
        <Select
          id="cc-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">All statuses</option>
          {['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={5} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
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
                    <Td>{new Date(c.countDate).toLocaleDateString('en-IN')}</Td>
                    <Td>{c.countType.replace(/_/g, ' ').toLowerCase()}</Td>
                    <Td>
                      <Ident value={c.warehouseId} />
                    </Td>
                    <Td align="right">
                      <Num value={c.items.length} />
                    </Td>
                    <Td align="right">
                      <Num value={c.discrepancyCount ?? 0} />
                    </Td>
                    <Td align="right">
                      <Money amount={c.totalDiscrepancyValueInr ?? 0} />
                    </Td>
                    <Td>
                      <StatusBadge kind={countKind(c.status)} label={pretty(c.status)} />
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
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <ScheduleCount open={creating} onClose={() => setCreating(false)} />
      <CountDetail count={open} onClose={() => setOpenId(null)} />
    </div>
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
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Schedule a cycle count"
      description="Creates it as SCHEDULED. Nothing is counted or changed until someone starts it."
    >
      <FormField label="Warehouse" htmlFor="cc-wh">
        <Select id="cc-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Select a warehouse…</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Scope" htmlFor="cc-type" hint="What the counters are being asked to walk.">
        <Select id="cc-type" value={countType} onChange={(e) => setCountType(e.target.value)}>
          {COUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Count date" htmlFor="cc-date">
        <Input
          id="cc-date"
          type="date"
          value={countDate}
          onChange={(e) => setCountDate(e.target.value)}
        />
      </FormField>

      {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={warehouseId === '' || create.isPending}
          onClick={() =>
            create.mutate(
              { warehouseId, countType, countDate: new Date(countDate).toISOString() },
              { onSuccess: close },
            )
          }
        >
          {create.isPending ? 'Scheduling…' : 'Schedule'}
        </Button>
      </ModalFooter>
    </Modal>
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
    <Modal
      open={count !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Cycle count"
      description={
        count === null ? undefined : (
          <span className="flex items-center gap-2">
            <StatusBadge kind={countKind(count.status)} label={pretty(count.status)} />
            <span className="text-text-faint">
              {count.countType.replace(/_/g, ' ').toLowerCase()} ·{' '}
              {new Date(count.countDate).toLocaleDateString('en-IN')}
            </span>
          </span>
        )
      }
    >
      {count !== null && (
        <>
          <DescriptionList
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
            <Section
              title="Record a counted line"
              subtitle="System quantity is snapshotted when you record, not when the count was scheduled."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Variant id" htmlFor="cc-variant">
                  <Input
                    id="cc-variant"
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                    placeholder="uuid"
                  />
                </FormField>
                <FormField label="Counted quantity" htmlFor="cc-qty">
                  <Input
                    id="cc-qty"
                    type="number"
                    min={0}
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Bin id"
                  htmlFor="cc-bin"
                  hint="Required — a count is per bin and batch"
                >
                  <Input id="cc-bin" value={binId} onChange={(e) => setBinId(e.target.value)} />
                </FormField>
                <FormField
                  label="Batch id"
                  htmlFor="cc-batch"
                  hint="Required — a count is per bin and batch"
                >
                  <Input
                    id="cc-batch"
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField
                label="Notes"
                htmlFor="cc-notes"
                hint="Required — a count is per bin and batch"
              >
                <Textarea
                  id="cc-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the number alone will not explain."
                />
              </FormField>
              <Button
                size="md"
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
              >
                {record.isPending ? 'Recording…' : 'Record line'}
              </Button>
            </Section>
          )}

          <Section
            title={`Counted lines (${count.items.length})`}
            subtitle={
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
                        <Td align="right">
                          <Num value={i.systemQty} />
                        </Td>
                        <Td align="right">
                          <Num value={i.countedQty} />
                        </Td>
                        <Td align="right">
                          {diff === 0 ? (
                            <span className="text-text-faint">—</span>
                          ) : (
                            <span className={diff < 0 ? 'text-[var(--color-bad)]' : ''}>
                              {diff > 0 ? '+' : ''}
                              {diff}
                            </span>
                          )}
                        </Td>
                        <Td>{i.notes ?? '—'}</Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Section>

          {error !== null && error !== undefined && <ErrorNote message={serverVerdict(error)} />}
        </>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Close
        </Button>
        {count !== null && scheduled && (
          <Button
            size="md"
            disabled={start.isPending}
            onClick={() => start.mutate({ id: count.id })}
          >
            {start.isPending ? 'Starting…' : 'Start counting'}
          </Button>
        )}
        {count !== null && inProgress && (
          <Button
            size="md"
            disabled={complete.isPending}
            onClick={() => complete.mutate({ id: count.id }, { onSuccess: close })}
          >
            {complete.isPending
              ? 'Completing…'
              : discrepancies.length === 0
                ? 'Complete — no adjustments'
                : `Complete — raises ${discrepancies.length} adjustment${discrepancies.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
