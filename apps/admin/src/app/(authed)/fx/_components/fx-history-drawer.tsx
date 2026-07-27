'use client';

import type { ReactElement } from 'react';
import { ErrorState, LoadingState, Modal } from '@skydrop/ui/components';
import { useFxRateHistory } from '@/lib/api-hooks';

export function FxHistoryDrawer({
  fromCurrency,
  toCurrency,
  onClose,
}: {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly onClose: () => void;
}): ReactElement {
  const history = useFxRateHistory(fromCurrency, toCurrency);

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Timeline — ${fromCurrency} → ${toCurrency}`}
      description="Append-only history of every change; most recent first."
      size="lg"
    >
      {history.isLoading ? (
        <LoadingState label="Loading history…" />
      ) : history.isError ? (
        <ErrorState
          message={history.error?.message ?? 'Failed.'}
          retry={() => void history.refetch()}
        />
      ) : !history.data || history.data.length === 0 ? (
        <div className="text-text-muted text-sm py-4">
          No history yet. The first change you make will record here.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-medium">When</th>
              <th className="text-right px-3 py-2 font-medium">Rate</th>
              <th className="text-right px-3 py-2 font-medium">Previous</th>
              <th className="text-left px-3 py-2 font-medium">Source</th>
              <th className="text-left px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.data.map((h) => {
              const change =
                h.previousRate !== null ? Number(h.rate) - Number(h.previousRate) : null;
              return (
                <tr key={h.id}>
                  <td className="px-3 py-2 text-text-body font-mono text-xs">
                    {new Date(h.recordedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-text-bright font-mono">
                    {Number(h.rate).toFixed(6)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted font-mono text-xs">
                    {h.previousRate === null ? (
                      '—'
                    ) : (
                      <>
                        {Number(h.previousRate).toFixed(6)}
                        {change !== null && (
                          <span
                            className={
                              change > 0
                                ? 'text-accent ml-2'
                                : change < 0
                                  ? 'text-critical ml-2'
                                  : 'text-text-faint ml-2'
                            }
                          >
                            {change > 0 ? '↑' : change < 0 ? '↓' : '='}
                            {Math.abs(change).toFixed(6)}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-body text-xs">
                    {h.source}
                    {h.isManualOverride && (
                      <span className="text-pending text-[10px] ml-2 uppercase">Manual</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs max-w-[280px] truncate">
                    {h.changeReason ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
