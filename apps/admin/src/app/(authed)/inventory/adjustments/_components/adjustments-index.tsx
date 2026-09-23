'use client';

import { useState, type ReactElement } from 'react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { Check, ClipboardList, Hourglass, Scale, X } from 'lucide-react';
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
import { TextArea } from '@skydrop/ui/app/text-field';
import {
  useAdjustmentsList,
  useApproveAdjustment,
  useRejectAdjustment,
  type StockAdjustmentView,
} from '@/lib/inventory-hooks';
import type { AdjustmentPrefill } from '@/lib/adjustment-prefill';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AreaPage,
  AreaSection,
  Facts,
  InlineError,
  KpiGrid,
  Note,
  Panel,
  PanelPad,
  Stack,
  Toolbar,
  mutationPhase,
} from '../../_components/stock-kit';
import { NewAdjustmentPanel } from './new-adjustment-panel';

const PAGE_SIZE = 25;

const STATUSES = ['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED'] as const;

/**
 * Stock adjustments (INV-7 / INV-8).
 *
 * INV-8 splits adjustments by value: below the threshold they initiate
 * and execute in one transaction, above it they land in
 * PENDING and wait for a human. This screen is that human.
 * Until it existed the approval queue had no reader at all, so a
 * warehouse that miscounted anything expensive could not correct it
 * through any interface.
 *
 * PENDING is the default filter for that reason: everything
 * else here is history, and only this one is a job.
 */
export function AdjustmentsIndex({
  prefill = null,
}: {
  readonly prefill?: AdjustmentPrefill | null;
} = {}): ReactElement {
  const [status, setStatus] = useState<string>('PENDING');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<StockAdjustmentView | null>(null);

  const list = useAdjustmentsList({
    ...(status === '' ? {} : { status }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pending = items.filter((a) => a.status === 'PENDING');
  const valueAtStake = pending.reduce(
    (sum, a) => sum + Math.abs(Number(a.totalValueImpactInr ?? 0)),
    0,
  );

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Adjustments' }]}
        title="Stock adjustments"
        subtitle="Corrections to counted stock. Anything above the value threshold waits here for a second pair of eyes before it moves inventory."
        action={<NewAdjustmentPanel prefill={prefill} />}
      />

      <KpiGrid>
        <KpiCard label="Rows shown" icon={<ClipboardList size={14} />} value={items.length} />
        <KpiCard
          label="Awaiting approval"
          icon={<Hourglass size={14} />}
          value={pending.length}
          tone={pending.length > 0 ? 'pending' : 'neutral'}
        />
        <KpiCard
          label="Value at stake"
          icon={<Scale size={14} />}
          hint="Absolute impact of the pending rows on this page"
          figure={<Money amount={valueAtStake} decimals={false} />}
        />
      </KpiGrid>

      <Stack>
        <Toolbar>
          <Select
            id="adj-status"
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Toolbar>

        {list.isLoading ? (
          <SkeletonRows rows={6} cols={7} />
        ) : list.isError ? (
          <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            tone={status === 'PENDING' ? 'positive' : 'neutral'}
            title={status === 'PENDING' ? 'Nothing waiting' : 'No adjustments'}
            description={
              status === 'PENDING'
                ? 'No adjustment is above the approval threshold right now. Smaller corrections apply immediately — look under Executed for those.'
                : 'Adjustments come from warehouse staff, or from completing a cycle count with discrepancies.'
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Raised</Th>
                  <Th>Type</Th>
                  <Th>Reason</Th>
                  <Th align="right">Lines</Th>
                  <Th align="right">Value impact</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((a) => (
                  <Tr key={a.id}>
                    <Td className="sk-figure stk-nowrap">
                      {new Date(a.initiatedAt).toLocaleDateString('en-IN')}
                    </Td>
                    <Td>{a.type}</Td>
                    <Td>{a.reasonCode ?? '—'}</Td>
                    <Td align="right" className="sk-figure">
                      <Num value={a.lines.length} />
                    </Td>
                    <Td align="right">
                      <Money
                        amount={a.totalValueImpactInr ?? 0}
                        direction={Number(a.totalValueImpactInr ?? 0) < 0 ? 'debit' : 'credit'}
                      />
                    </Td>
                    <Td>
                      <StatusChip
                        size="sm"
                        kind={adjustmentKind(a.status)}
                        label={pretty(a.status)}
                      />
                    </Td>
                    <Td align="right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(a)}>
                        {a.status === 'PENDING' ? 'Review' : 'View'}
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

      <AdjustmentReview adjustment={selected} onClose={() => setSelected(null)} />
    </AreaPage>
  );
}

function pretty(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase();
}

/**
 * Adjustment status → one of the shared semantic kinds (FE-6).
 *
 * Deliberately not a new vocabulary in `@skydrop/ui/status`: unlike the
 * order and ticket enums this one is read in a single place, and four
 * values do not earn an exhaustive mapper. If a second screen renders
 * these, move it there instead of copying this.
 */
function adjustmentKind(status: string): 'pending' | 'confirmed' | 'delivered' | 'failed' {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
      return 'confirmed';
    case 'EXECUTED':
      return 'delivered';
    default:
      return 'failed';
  }
}

/**
 * The decision.
 *
 * Approving does not flip a flag — it enqueues the executor, which
 * writes real stock movements. So the panel leads with what changes and
 * by how much, and the button says so. Rejecting demands a reason,
 * because "why did this not happen" is the question asked three months
 * later, by someone looking at a stock figure that never made sense.
 */
function AdjustmentReview({
  adjustment,
  onClose,
}: {
  adjustment: StockAdjustmentView | null;
  onClose: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const approve = useApproveAdjustment();
  const reject = useRejectAdjustment();

  const decided = adjustment !== null && adjustment.status !== 'PENDING';
  const error = approve.error ?? reject.error;

  function close(): void {
    setReason('');
    setRejecting(false);
    approve.reset();
    reject.reset();
    onClose();
  }

  return (
    <Dialog
      open={adjustment !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Stock adjustment"
      description={
        adjustment === null ? undefined : (
          <span className="adj-sub">
            <StatusChip
              size="sm"
              kind={adjustmentKind(adjustment.status)}
              label={pretty(adjustment.status)}
            />
            <span className="stk-faint">
              raised {new Date(adjustment.initiatedAt).toLocaleString()}
            </span>
          </span>
        )
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Close
          </Button>
          {adjustment !== null && !decided && !rejecting && (
            <>
              <Button
                variant="destructive"
                size="md"
                icon={<X size={16} />}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
              <AsyncButton
                size="md"
                icon={<Check size={16} />}
                state={mutationPhase(approve)}
                labels={{ idle: 'Approve — this moves stock', busy: 'Approving…' }}
                disabled={approve.isPending}
                onClick={() => approve.mutate({ id: adjustment.id }, { onSuccess: close })}
              />
            </>
          )}
          {adjustment !== null && !decided && rejecting && (
            <AsyncButton
              variant="destructive"
              size="md"
              state={mutationPhase(reject)}
              labels={{ idle: 'Confirm reject', busy: 'Rejecting…' }}
              disabled={reason.trim().length === 0 || reject.isPending}
              onClick={() =>
                reject.mutate({ id: adjustment.id, reason: reason.trim() }, { onSuccess: close })
              }
            />
          )}
        </DialogFooter>
      }
    >
      {adjustment !== null && (
        <Stack>
          <Facts
            columns={3}
            items={[
              { label: 'Type', value: adjustment.type },
              { label: 'Reason code', value: adjustment.reasonCode ?? '—' },
              {
                label: 'Value impact',
                value: (
                  <Money
                    amount={adjustment.totalValueImpactInr ?? 0}
                    direction={Number(adjustment.totalValueImpactInr ?? 0) < 0 ? 'debit' : 'credit'}
                  />
                ),
              },
              {
                label: 'Approval threshold',
                value:
                  adjustment.approverThresholdInr === null ? (
                    '—'
                  ) : (
                    <Money amount={adjustment.approverThresholdInr} />
                  ),
              },
              { label: 'Warehouse', value: <Ident value={adjustment.warehouseId} /> },
              { label: 'Seller', value: <Ident value={adjustment.sellerId} /> },
            ]}
          />

          {adjustment.description !== null && adjustment.description !== '' && (
            <AreaSection title="Description">
              <Note>{adjustment.description}</Note>
            </AreaSection>
          )}

          {adjustment.rejectedReason !== null && (
            <AreaSection title="Rejected because">
              <Note>{adjustment.rejectedReason}</Note>
            </AreaSection>
          )}

          <AreaSection title={`Lines (${adjustment.lines.length})`}>
            <Panel flush>
              <Table>
                <THead>
                  <Tr>
                    <Th>Variant</Th>
                    <Th>Bin</Th>
                    <Th>Batch</Th>
                    <Th align="right">Qty change</Th>
                    <Th align="right">Unit cost</Th>
                  </Tr>
                </THead>
                <TBody>
                  {adjustment.lines.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <Ident value={l.variantId} />
                      </Td>
                      <Td>{l.binId === null ? '—' : <Ident value={l.binId} />}</Td>
                      <Td>{l.batchId === null ? '—' : <Ident value={l.batchId} />}</Td>
                      <Td align="right" className="sk-figure">
                        <Num value={l.qtyChange} />
                      </Td>
                      <Td align="right">
                        {l.unitCostInr === null ? '—' : <Money amount={l.unitCostInr} />}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Panel>
          </AreaSection>

          {rejecting && (
            <TextArea
              label="Reason for rejecting"
              hint="Stored on the adjustment permanently."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What did you check, and what was actually on the shelf?"
            />
          )}

          {error !== null && error !== undefined && <InlineError message={serverVerdict(error)} />}
        </Stack>
      )}
    </Dialog>
  );
}
