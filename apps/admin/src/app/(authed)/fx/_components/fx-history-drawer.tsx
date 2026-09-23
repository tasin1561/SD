'use client';

import type { ReactElement } from 'react';
import { Dialog } from '@skydrop/ui/app/dialog';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Timeline — ${fromCurrency} → ${toCurrency}`}
      description="Append-only history of every change; most recent first."
      size="lg"
    >
      {history.isLoading ? (
        <SkeletonRows rows={4} cols={5} label="Loading history…" />
      ) : history.isError ? (
        <ErrorState
          message={history.error?.message ?? 'Failed.'}
          retry={() => void history.refetch()}
        />
      ) : !history.data || history.data.length === 0 ? (
        <EmptyState
          bare
          title="No history yet"
          description="The first change you make will record here."
        />
      ) : (
        <Table caption={`Rate history for ${fromCurrency} to ${toCurrency}`}>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th align="right">Rate</Th>
              <Th align="right">Previous</Th>
              <Th>Source</Th>
              <Th>Reason</Th>
            </Tr>
          </THead>
          <TBody>
            {history.data.map((h) => {
              const change =
                h.previousRate !== null ? Number(h.rate) - Number(h.previousRate) : null;
              return (
                <Tr key={h.id}>
                  <Td className="mk-when sk-figure">{new Date(h.recordedAt).toLocaleString()}</Td>
                  <Td align="right" className="mk-strong sk-figure">
                    {Number(h.rate).toFixed(6)}
                  </Td>
                  <Td align="right" className="mk-small sk-figure">
                    {h.previousRate === null ? (
                      '—'
                    ) : (
                      <>
                        {Number(h.previousRate).toFixed(6)}
                        {change !== null && (
                          <span
                            className="mk-text"
                            data-tone={change > 0 ? 'good' : change < 0 ? 'critical' : undefined}
                          >
                            {' '}
                            {change > 0 ? '↑' : change < 0 ? '↓' : '='}
                            {Math.abs(change).toFixed(6)}
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td className="mk-small mk-body">
                    {h.source}
                    {h.isManualOverride && <span className="mk-tag">Manual</span>}
                  </Td>
                  <Td className="mk-small">
                    <span className="mk-clip" title={h.changeReason ?? undefined}>
                      {h.changeReason ?? '—'}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Dialog>
  );
}
