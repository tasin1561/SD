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
import { useT } from '@/i18n/client';

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
  const tr = useT();
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
        breadcrumbs={[
          { label: tr('inventoryCycleCountsCycleCountsIndex.inventory') },
          { label: tr('inventoryCycleCountsCycleCountsIndex.cycleCounts') },
        ]}
        title={tr('inventoryCycleCountsCycleCountsIndex.cycleCounts')}
        subtitle={tr('inventoryCycleCountsCycleCountsIndex.physicalVerificationAgainstWhatThe')}
        action={
          <Button icon={<CalendarPlus size={16} />} onClick={() => setCreating(true)}>
            {tr('inventoryCycleCountsCycleCountsIndex.scheduleACount')}
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard
          label={tr('inventoryCycleCountsCycleCountsIndex.countsShown')}
          icon={<ListChecks size={14} />}
          value={items.length}
        />
        <KpiCard
          label={tr('inventoryCycleCountsCycleCountsIndex.inProgress')}
          icon={<ClipboardCheck size={14} />}
          value={items.filter((c) => c.status === 'IN_PROGRESS').length}
        />
        <KpiCard
          label={tr('inventoryCycleCountsCycleCountsIndex.discrepanciesFound')}
          icon={<TriangleAlert size={14} />}
          hint={tr('inventoryCycleCountsCycleCountsIndex.acrossTheCountsOnThis')}
          value={items.reduce((n, c) => n + (c.discrepancyCount ?? 0), 0)}
        />
      </KpiGrid>

      <Stack>
        <Toolbar>
          <Select
            id="cc-status"
            label={tr('inventoryCycleCountsCycleCountsIndex.status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{tr('inventoryCycleCountsCycleCountsIndex.allStatuses')}</option>
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
            title={tr('inventoryCycleCountsCycleCountsIndex.noCycleCounts')}
            description={tr('inventoryCycleCountsCycleCountsIndex.scheduleOneToReconcileA')}
            action={
              <Button onClick={() => setCreating(true)}>
                {tr('inventoryCycleCountsCycleCountsIndex.scheduleACount')}
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>{tr('inventoryCycleCountsCycleCountsIndex.date')}</Th>
                  <Th>{tr('inventoryCycleCountsCycleCountsIndex.type')}</Th>
                  <Th>{tr('inventoryCycleCountsCycleCountsIndex.warehouse')}</Th>
                  <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.items')}</Th>
                  <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.discrepancies')}</Th>
                  <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.value')}</Th>
                  <Th>{tr('inventoryCycleCountsCycleCountsIndex.status')}</Th>
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
                        {tr('inventoryCycleCountsCycleCountsIndex.open')}
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
  const tr = useT();
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
      title={tr('inventoryCycleCountsCycleCountsIndex.scheduleACycleCount')}
      description={tr('inventoryCycleCountsCycleCountsIndex.createsItAsScheduledNothing')}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {tr('inventoryCycleCountsCycleCountsIndex.cancel')}
          </Button>
          <AsyncButton
            size="md"
            state={mutationPhase(create)}
            labels={{
              idle: tr('inventoryCycleCountsCycleCountsIndex.schedule'),
              busy: tr('inventoryCycleCountsCycleCountsIndex.scheduling'),
            }}
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
          label={tr('inventoryCycleCountsCycleCountsIndex.warehouse')}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">{tr('inventoryCycleCountsCycleCountsIndex.selectAWarehouse')}</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </Select>

        <Select
          id="cc-type"
          label={tr('inventoryCycleCountsCycleCountsIndex.scope')}
          hint={tr('inventoryCycleCountsCycleCountsIndex.whatTheCountersAreBeing')}
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
          label={tr('inventoryCycleCountsCycleCountsIndex.countDate')}
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
  const tr = useT();
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
      title={tr('inventoryCycleCountsCycleCountsIndex.cycleCount')}
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
            {tr('inventoryCycleCountsCycleCountsIndex.close')}
          </Button>
          {count !== null && scheduled && (
            <AsyncButton
              size="md"
              state={mutationPhase(start)}
              labels={{
                idle: tr('inventoryCycleCountsCycleCountsIndex.startCounting'),
                busy: tr('inventoryCycleCountsCycleCountsIndex.starting'),
              }}
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
                    ? tr('inventoryCycleCountsCycleCountsIndex.completeNoAdjustments')
                    : tr('inventoryCycleCountsCycleCountsIndex.completeRaisesAdjustment', {
                        length: discrepancies.length,
                        value: discrepancies.length === 1 ? '' : tr('common.pluralS'),
                      }),
                busy: tr('inventoryCycleCountsCycleCountsIndex.completing'),
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
              {
                label: tr('inventoryCycleCountsCycleCountsIndex.warehouse'),
                value: <Ident value={count.warehouseId} />,
              },
              {
                label: tr('inventoryCycleCountsCycleCountsIndex.zone'),
                value:
                  count.zoneId === null ? (
                    tr('inventoryCycleCountsCycleCountsIndex.wholeWarehouse')
                  ) : (
                    <Ident value={count.zoneId} />
                  ),
              },
              {
                label: tr('inventoryCycleCountsCycleCountsIndex.started'),
                value: count.startedAt === null ? '—' : new Date(count.startedAt).toLocaleString(),
              },
              {
                label: tr('inventoryCycleCountsCycleCountsIndex.completed'),
                value:
                  count.completedAt === null ? '—' : new Date(count.completedAt).toLocaleString(),
              },
            ]}
          />

          {inProgress && (
            <AreaSection
              title={tr('inventoryCycleCountsCycleCountsIndex.recordACountedLine')}
              note={tr('inventoryCycleCountsCycleCountsIndex.systemQuantityIsSnapshottedWhen')}
            >
              <Panel>
                <FieldGrid columns={2}>
                  <TextField
                    id="cc-variant"
                    label={tr('inventoryCycleCountsCycleCountsIndex.variantId')}
                    inputClassName="sk-ident"
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                    placeholder="uuid"
                  />
                  <TextField
                    id="cc-qty"
                    label={tr('inventoryCycleCountsCycleCountsIndex.countedQuantity')}
                    type="number"
                    min={0}
                    inputClassName="sk-figure"
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                  />
                  <TextField
                    id="cc-bin"
                    label={tr('inventoryCycleCountsCycleCountsIndex.binId')}
                    hint={tr('inventoryCycleCountsCycleCountsIndex.requiredACountIsPer')}
                    inputClassName="sk-ident"
                    value={binId}
                    onChange={(e) => setBinId(e.target.value)}
                  />
                  <TextField
                    id="cc-batch"
                    label={tr('inventoryCycleCountsCycleCountsIndex.batchId')}
                    hint={tr('inventoryCycleCountsCycleCountsIndex.requiredACountIsPer')}
                    inputClassName="sk-ident"
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                  />
                </FieldGrid>
                {/*
                  ITS OWN HINT. This carried the BIN AND BATCH one —
                  "Required — a count is per bin and batch" — copied
                  down from the two fields above it, so an optional
                  free-text box told the counter it was required, and
                  told them so with a sentence about two other fields.
                  Found by filming it (L2, 2026-10-01); nothing throws,
                  and the form submits perfectly well without it.
                */}
                <TextArea
                  id="cc-notes"
                  label={tr('inventoryCycleCountsCycleCountsIndex.notes')}
                  hint={tr('inventoryCycleCountsCycleCountsIndex.optionalKeptOnTheLine')}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={tr(
                    'inventoryCycleCountsCycleCountsIndex.anythingTheNumberAloneWill',
                  )}
                />
                <div className="stk-actions">
                  <AsyncButton
                    size="md"
                    state={mutationPhase(record)}
                    labels={{
                      idle: tr('inventoryCycleCountsCycleCountsIndex.recordLine'),
                      busy: tr('inventoryCycleCountsCycleCountsIndex.recording'),
                    }}
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
            title={tr('inventoryCycleCountsCycleCountsIndex.countedLines', {
              itemsLength: count.items.length,
            })}
            note={
              discrepancies.length === 0
                ? tr('inventoryCycleCountsCycleCountsIndex.everyLineMatchesTheSystem')
                : tr('inventoryCycleCountsCycleCountsIndex.differFromTheSystemCompleting', {
                    length: discrepancies.length,
                  })
            }
          >
            {count.items.length === 0 ? (
              <EmptyState
                bare
                title={tr('inventoryCycleCountsCycleCountsIndex.nothingCountedYet')}
                description={
                  scheduled
                    ? tr('inventoryCycleCountsCycleCountsIndex.startTheCountBeforeRecording')
                    : tr('inventoryCycleCountsCycleCountsIndex.recordTheFirstLineAbove')
                }
              />
            ) : (
              <Panel flush>
                <Table>
                  <THead>
                    <Tr>
                      <Th>{tr('inventoryCycleCountsCycleCountsIndex.variant')}</Th>
                      <Th>{tr('inventoryCycleCountsCycleCountsIndex.bin')}</Th>
                      <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.system')}</Th>
                      <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.counted')}</Th>
                      <Th align="right">{tr('inventoryCycleCountsCycleCountsIndex.difference')}</Th>
                      <Th>{tr('inventoryCycleCountsCycleCountsIndex.notes')}</Th>
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
