'use client';

import { Code } from '@/components/easy/code-label';
import { useState, type ReactElement } from 'react';
import type { OrderChargeView } from '@skydrop/api-client';
import { useComputeOrderCharges, useOrderCharges } from '@/lib/api-hooks';
import { Calculator, Receipt } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { OoCard } from './order-ops-parts';
import './order-core.css';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * Admin order-charges section (Module 17). Renders all charge rows
 * (no isVisibleToSeller filter on the admin endpoint), plus a
 * "Compute & persist" action that calls PricingEngineService and
 * inserts the breakdown. Idempotent: rejects with
 * [CHARGES_ALREADY_EXIST] if rows already exist (FE-2 verbatim).
 */
export interface OrderChargesPanel {
  readonly canView: boolean;
  readonly canCompute: boolean;
  readonly charges: ReturnType<typeof useOrderCharges>;
  readonly total: number;
  readonly computing: boolean;
  readonly serverError: string | null;
  readonly confirmOpen: boolean;
  /** Same confirm the in-card button opens. */
  readonly openCompute: () => void;
  /** The compute confirm. Mount once. */
  readonly dialog: ReactElement;
}

/**
 * The charges query, the permission gates and the compute confirm, as a
 * hook: the order page shows the same section in its Items & charges card
 * and offers "Compute & persist" from the header's More menu, and both
 * must open ONE confirm with ONE verdict. The gates are the ones the
 * section always had — `orders.charges.view` for the data (and the
 * query), `orders.charges.compute` for the action.
 */
export function useOrderChargesPanel(orderId: string, orderNumber?: string): OrderChargesPanel {
  const t = useT();
  // The section is on the order page, which anyone with `orders.view`
  // may open — but the money is a separate permission. Gated on the
  // QUERY too, so somebody without it never issues the request.
  const canView = usePermission('orders.charges.view');
  const canCompute = usePermission('orders.charges.compute');
  const charges = useOrderCharges(orderId, { enabled: canView });
  const compute = useComputeOrderCharges(orderId);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  async function handleCompute(): Promise<void> {
    setServerError(null);
    try {
      await compute.mutateAsync();
      toast.success(t('ordersOrderCharges.chargesComputedAndSaved'));
    } catch (err) {
      setServerError(serverVerdict(err, t('ordersOrderCharges.computeFailed')));
      throw err;
    }
  }

  const total = charges.data?.reduce((sum, c) => sum + Number(c.totalAmountInr), 0) ?? 0;

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={t('ordersOrderCharges.computeAndSaveThisOrder')}
      entity={orderNumber ?? orderId}
      entityIsIdentifier
      consequence={t('ordersOrderCharges.thePricingEngineEvaluatesThis')}
      confirmLabel={t('ordersOrderCharges.computePersistCharges')}
      onConfirm={handleCompute}
      error={serverError}
    />
  );

  return {
    canView,
    canCompute,
    charges,
    total,
    computing: compute.isPending,
    serverError,
    confirmOpen,
    openCompute: () => {
      setServerError(null);
      setConfirmOpen(true);
    },
    dialog,
  };
}

/** The charges table, with its total row. */
export function ChargesTable({
  rows,
  total,
}: {
  readonly rows: readonly OrderChargeView[];
  readonly total: number;
}): ReactElement {
  const t = useT();
  return (
    <Table caption={t('ordersOrderCharges.charges')}>
      <THead>
        <Tr>
          <Th>{t('ordersOrderCharges.charge')}</Th>
          <Th>{t('ordersOrderCharges.visibility')}</Th>
          <Th align="right">{t('ordersOrderCharges.amountInr')}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((c) => (
          <ChargeRow key={c.id} charge={c} />
        ))}
        <Tr className="oc-total-row">
          <Td colSpan={2}>{t('ordersOrderCharges.total')}</Td>
          <Td align="right">
            <Money amount={total} />
          </Td>
        </Tr>
      </TBody>
    </Table>
  );
}

export function OrderChargesSection({
  orderId,
  orderNumber,
}: {
  orderId: string;
  /** Restated in the compute confirm; the id stands in when it is not passed. */
  orderNumber?: string | undefined;
}): ReactElement {
  const t = useT();
  const cp = useOrderChargesPanel(orderId, orderNumber);
  const { canView, canCompute, charges, total, computing, serverError, confirmOpen, openCompute } =
    cp;

  if (charges.isLoading) {
    return (
      <OoCard>
        <SkeletonRows rows={4} cols={3} label={t('ordersOrderCharges.loadingCharges')} />
      </OoCard>
    );
  }
  if (charges.isError) {
    return (
      <ErrorState
        message={serverVerdict(charges.error, t('ordersOrderCharges.failedToLoadCharges'))}
        retry={() => void charges.refetch()}
      />
    );
  }

  if (!canView) return <></>;

  return (
    <OoCard flush>
      <div className="oc-charges-head">
        <span className="oo-muted">
          {charges.data && charges.data.length > 0
            ? `${charges.data.length} line${charges.data.length === 1 ? '' : 's'}`
            : t('ordersOrderCharges.noCharges')}
        </span>
        {canCompute && (
          <Button
            variant="primary"
            icon={<Calculator size={15} />}
            onClick={openCompute}
            loading={computing}
          >
            {t('ordersOrderCharges.computePersistCharges')}
          </Button>
        )}
      </div>
      {serverError && !confirmOpen && (
        <div className="oo-card__pad">
          <p className="oo-error" role="alert">
            {serverError}
          </p>
        </div>
      )}
      {!charges.data || charges.data.length === 0 ? (
        <div className="oo-card__pad">
          <EmptyState
            bare
            icon={<Receipt size={20} />}
            title={t('ordersOrderCharges.noChargesPersistedYet')}
            description={t('ordersOrderCharges.clickComputePersistChargesTo')}
          />
        </div>
      ) : (
        <ChargesTable rows={charges.data} total={total} />
      )}

      {cp.dialog}
    </OoCard>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  const t = useT();
  return (
    <Tr>
      <Td>
        <span className="oo-body">{charge.description ?? humanizeType(charge.type)}</span>
        <span className="oo-sub">
          <Code value={charge.type} /> · <Code value={charge.status} />
        </span>
      </Td>
      <Td className="oo-muted">
        {charge.isVisibleToSeller
          ? t('ordersOrderCharges.clientVisible')
          : t('ordersOrderCharges.internal')}
      </Td>
      <Td align="right">
        <Money amount={charge.totalAmountInr} />
      </Td>
    </Tr>
  );
}

function humanizeType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
