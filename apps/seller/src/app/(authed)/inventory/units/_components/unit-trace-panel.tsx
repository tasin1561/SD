'use client';

import { useState, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  AreaSection,
  InlineError,
  Note,
  Panel,
  StockUnitStatusBadge,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { serverVerdict } from '@/lib/server-verdict';
import { useUnitTrace } from '@/lib/ops-hooks';

/**
 * Where one of your units has been.
 *
 * The lists above are about units that look WRONG. This answers a
 * different question, and one a seller asks about a unit that is fine:
 * a customer says they were sent the wrong thing, or a returned item
 * arrives and the question is whether it ever left.
 *
 * Scoped to the caller's own account by the server, so a serial another
 * company printed simply is not found. That is not a permission check
 * failing — `stock_units` is keyed on `(sellerId, serialBarcode)` and two
 * companies may legitimately print the same number.
 */
export function UnitTracePanel(): ReactElement {
  const [typed, setTyped] = useState('');
  const [serial, setSerial] = useState('');
  const trace = useUnitTrace(serial);

  const unit = trace.data?.unit ?? null;
  const events = trace.data?.events ?? [];

  return (
    <AreaSection
      title="Trace a serial"
      note="The number printed on a single unit. Its whole history, in the order it happened."
    >
      <Panel>
        <div className="inv-stack">
          <div className="inv-lookup">
            <TextField
              label="Serial"
              icon={<Search size={16} />}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              // A barcode gun types the number and presses Enter.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setSerial(typed.trim());
                }
              }}
              placeholder="Scan or type"
              inputClassName="sk-ident"
            />
            <AsyncButton
              variant="primary"
              size="lg"
              labels={{ idle: 'Trace', busy: 'Tracing…' }}
              state={serial !== '' && trace.isFetching ? 'busy' : 'idle'}
              disabled={typed.trim() === ''}
              onClick={() => setSerial(typed.trim())}
            />
          </div>

          {trace.isError && (
            <InlineError message={serverVerdict(trace.error)} retry={() => void trace.refetch()} />
          )}

          {trace.isLoading && serial !== '' && <SkeletonRows rows={3} />}

          {serial !== '' && !trace.isLoading && !trace.isError && unit === null && (
            <Note>
              No unit of yours carries that serial. Either the number belongs to something we never
              received, or this SKU is not tracked per unit.
            </Note>
          )}

          {unit !== null && (
            <>
              <div className="inv-callout" data-tone="info">
                <span className="sk-ident">{unit.serialBarcode}</span>
                <span>{unit.skuCode ?? unit.variantId}</span>
                <StockUnitStatusBadge status={unit.status} />
              </div>

              <Table caption={`History of ${unit.serialBarcode}`}>
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Moved</Th>
                    <Th>Step</Th>
                    <Th>Note</Th>
                  </Tr>
                </THead>
                <TBody>
                  {events.map((e, i) => (
                    <Tr key={`${e.at}-${i}`}>
                      <Td>
                        <span className="sk-figure inv-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(e.at).toLocaleString('en-IN')}
                        </span>
                      </Td>
                      <Td>
                        {/* The transition, not just the destination — a unit
                            that went picked → in stock came back off a
                            cancelled box, and that is the interesting part. */}
                        <span className="inv-muted">
                          {e.fromStatus === null
                            ? '—'
                            : e.fromStatus.toLowerCase().replace(/_/g, ' ')}
                        </span>{' '}
                        → {e.toStatus.toLowerCase().replace(/_/g, ' ')}
                      </Td>
                      <Td>{e.gate.toLowerCase().replace(/_/g, ' ')}</Td>
                      <Td>{e.note ?? '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </div>
      </Panel>
    </AreaSection>
  );
}
