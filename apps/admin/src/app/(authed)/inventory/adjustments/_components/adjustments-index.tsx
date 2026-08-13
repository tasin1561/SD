'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorNote,
  Ident,
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
import {
  useAdjustmentsList,
  useApproveAdjustment,
  useRejectAdjustment,
  type StockAdjustmentView,
} from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';
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
export function AdjustmentsIndex(): ReactElement {
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
    <div>
      <PageHeader
        title="Stock adjustments"
        subtitle="Corrections to counted stock. Anything above the value threshold waits here for a second pair of eyes before it moves inventory."
        action={<NewAdjustmentPanel />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Rows shown" value={<Num value={items.length} />} />
        <Stat
          label="Awaiting approval"
          value={<Num value={pending.length} />}
          tone={pending.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Value at stake"
          hint="Absolute impact of the pending rows on this page"
          value={<Money amount={valueAtStake} decimals={false} />}
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="adj-status">
          Status
        </label>
        <Select
          id="adj-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={6} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
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
                    <Td>{new Date(a.initiatedAt).toLocaleDateString('en-IN')}</Td>
                    <Td>{a.type}</Td>
                    <Td>{a.reasonCode ?? '—'}</Td>
                    <Td align="right">
                      <Num value={a.lines.length} />
                    </Td>
                    <Td align="right">
                      <Money
                        amount={a.totalValueImpactInr ?? 0}
                        direction={Number(a.totalValueImpactInr ?? 0) < 0 ? 'debit' : 'credit'}
                      />
                    </Td>
                    <Td>
                      <StatusBadge kind={adjustmentKind(a.status)} label={pretty(a.status)} />
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
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <AdjustmentReview adjustment={selected} onClose={() => setSelected(null)} />
    </div>
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
    <Modal
      open={adjustment !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Stock adjustment"
      description={
        adjustment === null ? undefined : (
          <span className="flex items-center gap-2">
            <StatusBadge
              kind={adjustmentKind(adjustment.status)}
              label={pretty(adjustment.status)}
            />
            <span className="text-text-faint">
              raised {new Date(adjustment.initiatedAt).toLocaleString()}
            </span>
          </span>
        )
      }
    >
      {adjustment !== null && (
        <>
          <DescriptionList
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
            <Section title="Description">
              <p className="text-text-muted text-sm">{adjustment.description}</p>
            </Section>
          )}

          {adjustment.rejectedReason !== null && (
            <Section title="Rejected because">
              <p className="text-text-muted text-sm">{adjustment.rejectedReason}</p>
            </Section>
          )}

          <Section title={`Lines (${adjustment.lines.length})`}>
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
                    <Td align="right">
                      <Num value={l.qtyChange} />
                    </Td>
                    <Td align="right">
                      {l.unitCostInr === null ? '—' : <Money amount={l.unitCostInr} />}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Section>

          {rejecting && (
            <Section title="Reason for rejecting" subtitle="Stored on the adjustment permanently.">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What did you check, and what was actually on the shelf?"
              />
            </Section>
          )}

          {error !== null && error !== undefined && <ErrorNote message={serverVerdict(error)} />}
        </>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Close
        </Button>
        {adjustment !== null && !decided && !rejecting && (
          <>
            <Button variant="destructive" size="md" onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <Button
              size="md"
              disabled={approve.isPending}
              onClick={() => approve.mutate({ id: adjustment.id }, { onSuccess: close })}
            >
              {approve.isPending ? 'Approving…' : 'Approve — this moves stock'}
            </Button>
          </>
        )}
        {adjustment !== null && !decided && rejecting && (
          <Button
            variant="destructive"
            size="md"
            disabled={reason.trim().length === 0 || reject.isPending}
            onClick={() =>
              reject.mutate({ id: adjustment.id, reason: reason.trim() }, { onSuccess: close })
            }
          >
            {reject.isPending ? 'Rejecting…' : 'Confirm reject'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
