'use client';

import { useState, type ReactElement } from 'react';
import { ApiError, type OrderChargeView } from '@skydrop/api-client';
import { useComputeOrderCharges, useOrderCharges } from '@/lib/api-hooks';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Money,
  SkeletonRows,
} from '@skydrop/ui/components';

/**
 * Admin order-charges section (Module 17). Renders all charge rows
 * (no isVisibleToSeller filter on the admin endpoint), plus a
 * "Compute & persist" action that calls PricingEngineService and
 * inserts the breakdown. Idempotent: rejects with
 * [CHARGES_ALREADY_EXIST] if rows already exist (FE-2 verbatim).
 */
export function OrderChargesSection({ orderId }: { orderId: string }): ReactElement {
  const charges = useOrderCharges(orderId);
  const compute = useComputeOrderCharges(orderId);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleCompute(): Promise<void> {
    setServerError(null);
    try {
      await compute.mutateAsync();
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const b = err.body as { code?: unknown; message?: unknown };
        const code = typeof b.code === 'string' ? b.code : (err.code ?? 'COMPUTE_FAILED');
        const msg = typeof b.message === 'string' ? b.message : err.message;
        setServerError(`[${code}] ${msg}`);
      } else {
        setServerError('Compute failed.');
      }
    }
  }

  if (charges.isLoading) {
    return (
      <Card>
        <SkeletonRows rows={4} cols={3} />
      </Card>
    );
  }
  if (charges.isError) {
    return <ErrorState message={charges.error?.message ?? 'Failed to load charges.'} />;
  }

  const total = charges.data?.reduce((sum, c) => sum + Number(c.totalAmountInr), 0) ?? 0;

  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-text-muted text-xs uppercase tracking-wide">
          {charges.data && charges.data.length > 0
            ? `${charges.data.length} line${charges.data.length === 1 ? '' : 's'}`
            : 'No charges'}
        </div>
        <Button onClick={handleCompute} disabled={compute.isPending}>
          {compute.isPending ? 'Computing…' : 'Compute & persist charges'}
        </Button>
      </div>
      {serverError && (
        <div className="px-4 py-2 border-b border-border text-critical text-xs bg-[var(--color-critical-tint)]">
          {serverError}
        </div>
      )}
      <CardBody className="p-0">
        {!charges.data || charges.data.length === 0 ? (
          <EmptyState
            title="No charges persisted yet"
            description="Click 'Compute & persist charges' to evaluate via the M15 pricing engine."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Charge</th>
                <th className="text-left px-4 py-2 font-medium">Visibility</th>
                <th className="text-right px-4 py-2 font-medium">Amount (INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {charges.data.map((c) => (
                <ChargeRow key={c.id} charge={c} />
              ))}
              <tr className="bg-surface-raised">
                <td colSpan={2} className="px-4 py-2 text-text-bright font-medium">
                  Total
                </td>
                <td className="px-4 py-2 text-right text-text-bright font-medium">
                  <Money amount={total} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  return (
    <tr>
      <td className="px-4 py-2 text-text-body">
        <div className="text-sm">{charge.description ?? humanizeType(charge.type)}</div>
        <div className="text-text-faint text-[11px] uppercase tracking-wide mt-0.5">
          {charge.type.toLowerCase().replace(/_/g, ' ')} · {charge.status.toLowerCase()}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-text-muted">
        {charge.isVisibleToSeller ? 'Seller-visible' : 'Internal'}
      </td>
      <td className="px-4 py-2 text-right">
        <Money amount={charge.totalAmountInr} />
      </td>
    </tr>
  );
}

function humanizeType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
