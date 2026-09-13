'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  Num,
  PageHeader,
  SkeletonRows,
  Table,
  TablePaginator,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/components';
import { useBinContents } from '@/lib/bin-contents-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { BatchCell, ProductCell } from '../../_components/bin-contents-overview';
import { BinNote, binTypeLabel } from '../../_components/bin-note';

const PAGE_SIZE = 50;

/**
 * One bin, all of it — the deep link from the bins page, and where a bin
 * too full to show inline is read in pages. Adds what the overview leaves
 * out to stay fast: when each line last moved in this bin, and a way into
 * the movement ledger filtered to it.
 */
export function BinDetail({ binId }: { readonly binId: string }): ReactElement {
  const [page, setPage] = useState(1);
  const contents = useBinContents(binId, page, PAGE_SIZE);
  const canSeeMovements = usePermission('inventory.view');
  const bin = contents.data?.bin;

  return (
    <div className="space-y-4">
      <PageHeader
        title={bin === undefined ? 'Bin' : `Bin ${bin.code}`}
        subtitle={
          bin === undefined
            ? 'What this bin holds.'
            : `${bin.warehouseCode} — ${bin.warehouseName} · zone ${bin.zoneCode ?? '—'} · ${binTypeLabel(bin.type)} · ${bin.pickable ? 'pickable' : 'not pickable'}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/warehouse/bins" className="underline">
              All bins
            </Link>
            {canSeeMovements && bin !== undefined && (
              <Link
                href={`/inventory/movements?warehouse=${bin.warehouseId}&bin=${bin.id}`}
                className="underline"
              >
                Movements for this bin
              </Link>
            )}
          </div>
        }
      />

      {contents.isLoading ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : contents.isError ? (
        <ErrorNote message={serverVerdict(contents.error)} retry={() => void contents.refetch()} />
      ) : bin === undefined || bin.lineCount === 0 ? (
        <EmptyState title="This bin is empty" description="Nothing is on hand or reserved here." />
      ) : (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm">
              <Num value={bin.unitsOnHand} suffix=" units" /> ·{' '}
              <Num value={bin.skuCount} suffix={bin.skuCount === 1 ? ' SKU' : ' SKUs'} />
              {bin.unitsReserved > 0 && (
                <>
                  {' '}
                  · <Num value={bin.unitsReserved} /> reserved for picks
                </>
              )}
            </p>
            <BinNote type={bin.type} />
            <Table>
              <THead>
                <Tr>
                  <Th>Product</Th>
                  <Th>SKU</Th>
                  <Th>Seller</Th>
                  <Th>Batch</Th>
                  <Th align="right">On hand</Th>
                  <Th align="right">Reserved</Th>
                  <Th>Last moved</Th>
                </Tr>
              </THead>
              <TBody>
                {(contents.data?.items ?? []).map((l) => (
                  <Tr key={l.stockLevelId}>
                    <Td>
                      <ProductCell line={l} />
                    </Td>
                    <Td>
                      {l.skuCode === null ? '—' : <span className="font-mono">{l.skuCode}</span>}
                    </Td>
                    <Td>{l.sellerName ?? <Ident value={l.sellerId} />}</Td>
                    <Td>
                      <BatchCell line={l} />
                    </Td>
                    <Td align="right">
                      <Num value={l.qtyOnHand} />
                    </Td>
                    <Td align="right">{l.qtyReserved > 0 ? <Num value={l.qtyReserved} /> : '—'}</Td>
                    <Td>
                      {l.lastMovementAt === null
                        ? '—'
                        : new Date(l.lastMovementAt).toLocaleString('en-IN')}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator
              page={page}
              pageSize={PAGE_SIZE}
              total={contents.data?.total ?? 0}
              onPageChange={setPage}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
