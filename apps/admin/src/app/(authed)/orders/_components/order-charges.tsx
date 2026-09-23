'use client';

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

/**
 * Admin order-charges section (Module 17). Renders all charge rows
 * (no isVisibleToSeller filter on the admin endpoint), plus a
 * "Compute & persist" action that calls PricingEngineService and
 * inserts the breakdown. Idempotent: rejects with
 * [CHARGES_ALREADY_EXIST] if rows already exist (FE-2 verbatim).
 */
export function OrderChargesSection({
  orderId,
  orderNumber,
}: {
  orderId: string;
  /** Restated in the compute confirm; the id stands in when it is not passed. */
  orderNumber?: string | undefined;
}): ReactElement {
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
      toast.success('Charges computed and saved.');
    } catch (err) {
      setServerError(serverVerdict(err, 'Compute failed.'));
      throw err;
    }
  }

  if (charges.isLoading) {
    return (
      <OoCard>
        <SkeletonRows rows={4} cols={3} label="Loading charges…" />
      </OoCard>
    );
  }
  if (charges.isError) {
    return (
      <ErrorState
        message={serverVerdict(charges.error, 'Failed to load charges.')}
        retry={() => void charges.refetch()}
      />
    );
  }

  const total = charges.data?.reduce((sum, c) => sum + Number(c.totalAmountInr), 0) ?? 0;

  if (!canView) return <></>;

  return (
    <OoCard flush>
      <div className="oc-charges-head">
        <span className="oo-muted">
          {charges.data && charges.data.length > 0
            ? `${charges.data.length} line${charges.data.length === 1 ? '' : 's'}`
            : 'No charges'}
        </span>
        {canCompute && (
          <Button
            variant="primary"
            icon={<Calculator size={15} />}
            onClick={() => {
              setServerError(null);
              setConfirmOpen(true);
            }}
            loading={compute.isPending}
          >
            Compute & persist charges
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
            title="No charges persisted yet"
            description="Click 'Compute & persist charges' to evaluate via the M15 pricing engine."
          />
        </div>
      ) : (
        <Table caption="Charges">
          <THead>
            <Tr>
              <Th>Charge</Th>
              <Th>Visibility</Th>
              <Th align="right">Amount (INR)</Th>
            </Tr>
          </THead>
          <TBody>
            {charges.data.map((c) => (
              <ChargeRow key={c.id} charge={c} />
            ))}
            <Tr className="oc-total-row">
              <Td colSpan={2}>Total</Td>
              <Td align="right">
                <Money amount={total} />
              </Td>
            </Tr>
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Compute and save this order's charges?"
        entity={orderNumber ?? orderId}
        entityIsIdentifier
        consequence="The pricing engine evaluates this order and writes its charge lines; they cannot be computed again once saved."
        confirmLabel="Compute & persist charges"
        onConfirm={handleCompute}
        error={serverError}
      />
    </OoCard>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  return (
    <Tr>
      <Td>
        <span className="oo-body">{charge.description ?? humanizeType(charge.type)}</span>
        <span className="oo-sub">
          {charge.type.toLowerCase().replace(/_/g, ' ')} · {charge.status.toLowerCase()}
        </span>
      </Td>
      <Td className="oo-muted">{charge.isVisibleToSeller ? 'Seller-visible' : 'Internal'}</Td>
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
