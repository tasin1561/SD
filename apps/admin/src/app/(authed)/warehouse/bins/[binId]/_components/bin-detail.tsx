'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Ident, Num } from '@skydrop/ui/components';
import { ArrowLeft, History } from 'lucide-react';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { adjustmentHref } from '@/lib/adjustment-prefill';
import { useBinContents } from '@/lib/bin-contents-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { BatchCell, ProductCell } from '../../_components/bin-contents-overview';
import { BinNote, binTypeLabel } from '../../_components/bin-note';
import {
  Actions,
  AreaPage,
  Code,
  InlineError,
  LinkButton,
  Panel,
  PanelPad,
  TextLink,
} from '../../../../inventory/_components/stock-kit';

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
  const canAdjust = usePermission('inventory.adjustments.create');
  const bin = contents.data?.bin;

  return (
    <AreaPage>
      <PageHeader
        Link={Link}
        breadcrumbs={[
          { label: 'Warehouse', href: '/warehouse' },
          { label: 'Bins', href: '/warehouse/bins' },
          { label: bin === undefined ? 'Bin' : bin.code },
        ]}
        title={bin === undefined ? 'Bin' : `Bin ${bin.code}`}
        subtitle={
          bin === undefined
            ? 'What this bin holds.'
            : `${bin.warehouseCode} — ${bin.warehouseName} · zone ${bin.zoneCode ?? '—'} · ${binTypeLabel(bin.type)} · ${bin.pickable ? 'pickable' : 'not pickable'}`
        }
        action={
          <Actions>
            <LinkButton href="/warehouse/bins" variant="ghost" icon={<ArrowLeft size={15} />}>
              All bins
            </LinkButton>
            {canSeeMovements && bin !== undefined && (
              <LinkButton
                href={`/inventory/movements?warehouse=${bin.warehouseId}&bin=${bin.id}`}
                variant="secondary"
                icon={<History size={15} />}
              >
                Movements for this bin
              </LinkButton>
            )}
          </Actions>
        }
      />

      {contents.isLoading ? (
        <SkeletonRows rows={6} cols={7} />
      ) : contents.isError ? (
        <InlineError
          message={serverVerdict(contents.error)}
          retry={() => void contents.refetch()}
        />
      ) : bin === undefined || bin.lineCount === 0 ? (
        <EmptyState title="This bin is empty" description="Nothing is on hand or reserved here." />
      ) : (
        <Panel flush>
          <PanelPad>
            <p className="stk-note sk-figure">
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
          </PanelPad>
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
                {canAdjust && <Th>Adjust</Th>}
              </Tr>
            </THead>
            <TBody>
              {(contents.data?.items ?? []).map((l) => (
                <Tr key={l.stockLevelId}>
                  <Td>
                    <ProductCell line={l} />
                  </Td>
                  <Td>{l.skuCode === null ? '—' : <Code>{l.skuCode}</Code>}</Td>
                  <Td>{l.sellerName ?? <Ident value={l.sellerId} />}</Td>
                  <Td>
                    <BatchCell line={l} />
                  </Td>
                  <Td align="right" className="sk-figure">
                    <Num value={l.qtyOnHand} />
                  </Td>
                  <Td align="right" className="sk-figure">
                    {l.qtyReserved > 0 ? <Num value={l.qtyReserved} /> : '—'}
                  </Td>
                  <Td>
                    {l.lastMovementAt === null
                      ? '—'
                      : new Date(l.lastMovementAt).toLocaleString('en-IN')}
                  </Td>
                  {canAdjust && (
                    <Td>
                      {/* The way stock leaves a bin by hand — for the
                          Damaged bin, back to the seller or scrapped. */}
                      <TextLink
                        href={adjustmentHref({
                          sellerId: l.sellerId,
                          variantId: l.variantId,
                          batchId: l.batchId,
                          binId: bin.id,
                          binType: bin.type,
                        })}
                        aria-label={`Adjust ${l.skuCode ?? 'this line'} in bin ${bin.code}`}
                      >
                        {bin.type === 'DAMAGED' ? 'Return or scrap' : 'Adjust'}
                      </TextLink>
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
          <PanelPad>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={contents.data?.total ?? 0}
              onPageChange={setPage}
            />
          </PanelPad>
        </Panel>
      )}
    </AreaPage>
  );
}
