'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  useToast,
} from '@skydrop/ui/components';
import type { FxRateView } from '@skydrop/api-client';
import { useFxRatesList } from '@/lib/api-hooks';
import { FxOverrideModal } from './fx-override-modal';
import { FxHistoryDrawer } from './fx-history-drawer';
import { usePermission } from '@/lib/use-permission';

export function FxRatesIndex(): ReactElement {
  const canWrite = usePermission('fx.manage');
  const list = useFxRatesList();
  const [editing, setEditing] = useState<FxRateView | null>(null);
  const [historyOf, setHistoryOf] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const toast = useToast();

  return (
    <div>
      <PageHeader
        title="FX rates"
        subtitle="Current rate per (from, to) pair. Override sets isManualOverride=true. Every change is recorded in the append-only history (Timeline)."
      />

      {list.isLoading ? (
        <LoadingState label="Loading rates…" />
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed.'} retry={() => void list.refetch()} />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-text-bright text-sm mb-1">No rates yet.</div>
            <p className="text-text-muted text-xs">
              Use Override to set the first rate for a currency pair.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <Table wrapperClassName="rounded-none border-0 bg-transparent">
            <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Pair</th>
                <th className="text-right px-3 py-2 font-medium">Rate</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">Fetched</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((r) => (
                <tr key={`${r.fromCurrency}-${r.toCurrency}`}>
                  <td className="px-3 py-2 text-text-body font-mono">
                    {r.fromCurrency} → {r.toCurrency}
                  </td>
                  <td className="px-3 py-2 text-right text-text-bright font-mono">
                    {Number(r.rate).toFixed(6)}
                  </td>
                  <td className="px-3 py-2 text-text-body text-xs">
                    {r.source}
                    {r.isManualOverride && (
                      <span className="text-pending text-xs ml-2 uppercase">Manual</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted font-mono text-xs">
                    {new Date(r.fetchedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setHistoryOf({
                            from: r.fromCurrency,
                            to: r.toCurrency,
                          })
                        }
                      >
                        Timeline
                      </Button>
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Override
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {editing && (
        <FxOverrideModal
          rate={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            toast.success('Rate overridden.');
          }}
        />
      )}
      {historyOf && (
        <FxHistoryDrawer
          fromCurrency={historyOf.from}
          toCurrency={historyOf.to}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </div>
  );
}
