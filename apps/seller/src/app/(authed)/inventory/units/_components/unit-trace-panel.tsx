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
import { verdict } from '@/i18n/verdict';
import { useUnitTrace } from '@/lib/ops-hooks';
import { useT } from '@/i18n/client';

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
  const t = useT();
  const [typed, setTyped] = useState('');
  const [serial, setSerial] = useState('');
  const trace = useUnitTrace(serial);

  const unit = trace.data?.unit ?? null;
  const events = trace.data?.events ?? [];

  return (
    <AreaSection
      title={t('inventoryUnits.traceASerial')}
      note={t('inventoryUnits.theNumberPrintedOn')}
    >
      <Panel>
        <div className="inv-stack">
          <div className="inv-lookup">
            <TextField
              label={t('inventoryUnits.serial')}
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
              placeholder={t('inventoryUnits.scanOrType')}
              inputClassName="sk-ident"
            />
            <AsyncButton
              variant="primary"
              size="lg"
              labels={{ idle: t('inventoryUnits.trace'), busy: t('inventoryUnits.tracing') }}
              state={serial !== '' && trace.isFetching ? 'busy' : 'idle'}
              disabled={typed.trim() === ''}
              onClick={() => setSerial(typed.trim())}
            />
          </div>

          {trace.isError && (
            <InlineError message={verdict(trace.error, t)} retry={() => void trace.refetch()} />
          )}

          {trace.isLoading && serial !== '' && <SkeletonRows rows={3} />}

          {serial !== '' && !trace.isLoading && !trace.isError && unit === null && (
            <Note>{t('inventoryUnits.noUnitOfYours')}</Note>
          )}

          {unit !== null && (
            <>
              <div className="inv-callout" data-tone="info">
                <span className="sk-ident">{unit.serialBarcode}</span>
                <span>{unit.skuCode ?? unit.variantId}</span>
                <StockUnitStatusBadge status={unit.status} />
              </div>

              <Table caption={t('inventoryUnits.historyOf', { serialBarcode: unit.serialBarcode })}>
                <THead>
                  <Tr>
                    <Th>{t('inventoryUnits.when')}</Th>
                    <Th>{t('inventoryUnits.moved')}</Th>
                    <Th>{t('inventoryUnits.step')}</Th>
                    <Th>{t('inventoryUnits.note')}</Th>
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
