'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { useRemittancesList } from '@/lib/api-hooks';
import { RemittanceFormModal } from './remittance-form-modal';

/**
 * Paginated list of recorded remittances. Each row links to the
 * seller detail page. The Record button opens the form modal.
 */
export function RemittancesIndex(): ReactElement {
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const list = useRemittancesList({ page: 1, pageSize: 50 });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Remittances"
        subtitle="Recorded payouts to sellers. Each entry debits the seller's wallet (and writes a paired FX credit for cross-currency)."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            Record remittance
          </Button>
        }
      />

      {list.isLoading ? (
        <LoadingState label="Loading remittances…" />
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed.'} />
      ) : !list.data || list.data.items.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-text-bright text-sm mb-1">
              No remittances yet.
            </div>
            <p className="text-text-muted text-xs mb-3">
              Record one to debit a seller's wallet and reflect the bank
              transfer in their ledger.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreating(true)}
            >
              Record remittance
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Paid at</th>
                <th className="text-left px-3 py-2 font-medium">Seller</th>
                <th className="text-right px-3 py-2 font-medium">Source</th>
                <th className="text-right px-3 py-2 font-medium">Destination</th>
                <th className="text-left px-3 py-2 font-medium">Bank ref</th>
                <th className="text-right px-3 py-2 font-medium">FX</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-text-body font-mono text-xs">
                    {new Date(r.paidAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-text-body">
                    <Link
                      href={`/sellers/${r.sellerId}`}
                      className="text-accent hover:underline font-mono text-xs"
                    >
                      {r.sellerId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right text-critical font-mono">
                    {formatMoney(r.sourceAmount, r.sourceCurrency)}
                  </td>
                  <td className="px-3 py-2 text-right text-accent font-mono">
                    {formatMoney(r.amount, r.currency)}
                  </td>
                  <td className="px-3 py-2 text-text-body font-mono text-xs">
                    {r.bankReference}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted font-mono text-xs">
                    {r.sourceCurrency === r.currency
                      ? '—'
                      : Number(r.fxRateSnapshot).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <RemittanceFormModal
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            toast.success('Remittance recorded.');
          }}
        />
      )}
    </div>
  );
}

function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  return `${currency === 'INR' ? '₹' : '৳'} ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
