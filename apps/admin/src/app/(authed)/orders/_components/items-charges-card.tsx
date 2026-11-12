'use client';

import { Calculator, Receipt } from 'lucide-react';
import type { ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import { DetailCard } from './detail-card';
import { ChargesTable, type OrderChargesPanel } from './order-charges';

/**
 * Items and charges in one card: the lines on the order, then what we
 * charge for them. "Compute & persist charges" lives in the card header as
 * a small ghost button — never a primary one; it is a once-per-order
 * recovery action, not the point of the page — and is also in the More
 * menu. Both open the SAME confirm (the hook's), with the same gating:
 * `orders.charges.view` for the money, `orders.charges.compute` for the
 * action, and nothing offered while the charges are loading or failed.
 */
export function ItemsChargesCard({
  order,
  panel,
  open,
  onOpenChange,
}: {
  readonly order: OrderView;
  readonly panel: OrderChargesPanel;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const { charges, canView, canCompute } = panel;
  const settled = !charges.isLoading && !charges.isError;
  const hasCharges = canView && charges.data !== undefined && charges.data.length > 0;

  return (
    <DetailCard
      id="od-items"
      title={t('orderDetail.card.itemsCharges')}
      titleText={t('orderDetail.card.itemsCharges')}
      meta={
        <>
          {t('orderDetail.items', { count: order.items.length })}
          {canView && charges.data !== undefined ? (
            <>
              {' · '}
              {t('orderDetail.charges')} <Money amount={panel.total} />
            </>
          ) : null}
        </>
      }
      actions={
        canView && canCompute && settled ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Calculator size={14} />}
            onClick={panel.openCompute}
            loading={panel.computing}
          >
            {t('ordersOrderCharges.computePersistCharges')}
          </Button>
        ) : undefined
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      <Table caption={t('orderDetail.itemsCaption')}>
        <THead>
          <Tr>
            <Th>{t('orderDetail.col.sku')}</Th>
            <Th>{t('orderDetail.col.product')}</Th>
            <Th align="right">{t('orderDetail.col.qty')}</Th>
            <Th align="right">{t('orderDetail.col.reserved')}</Th>
            <Th align="right">{t('orderDetail.col.weight')}</Th>
          </Tr>
        </THead>
        <TBody>
          {order.items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <span className="sk-ident">{item.skuCode}</span>
              </Td>
              <Td>
                {item.productName}
                {item.variantLabel && <span className="oo-muted"> · {item.variantLabel}</span>}
              </Td>
              <Td align="right">
                <span className="sk-figure">{item.quantity}</span>
              </Td>
              <Td align="right">
                <span className="sk-figure oo-muted">{item.qtyReserved}</span>
              </Td>
              <Td align="right">
                <span className="sk-figure oo-muted">{item.unitWeightGrams ?? '—'}</span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {canView ? (
        <div className="od-charges">
          {charges.isLoading ? (
            <SkeletonRows rows={3} cols={3} label={t('ordersOrderCharges.loadingCharges')} />
          ) : charges.isError ? (
            <ErrorState
              message={serverVerdict(charges.error, t('ordersOrderCharges.failedToLoadCharges'))}
              retry={() => void charges.refetch()}
            />
          ) : hasCharges && charges.data !== undefined ? (
            <ChargesTable rows={charges.data} total={panel.total} />
          ) : (
            <EmptyState
              bare
              icon={<Receipt size={18} />}
              title={t('ordersOrderCharges.noChargesPersistedYet')}
              description={t('ordersOrderCharges.clickComputePersistChargesTo')}
            />
          )}
          {panel.serverError && !panel.confirmOpen ? (
            <p className="oo-error" role="alert">
              {panel.serverError}
            </p>
          ) : null}
        </div>
      ) : null}
      {panel.dialog}
    </DetailCard>
  );
}
