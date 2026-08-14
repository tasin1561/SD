'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  SkeletonRows,
  StockUnitStatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/components';
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
    <Card className="mt-4">
      <CardHeader
        title="Trace a serial"
        subtitle="The number printed on a single unit. Its whole history, in the order it happened."
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <FormField label="Serial" className="min-w-[220px] flex-1">
            <Input
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
            />
          </FormField>
          <Button
            variant="primary"
            size="md"
            disabled={typed.trim() === ''}
            onClick={() => setSerial(typed.trim())}
          >
            Trace
          </Button>
        </div>

        {trace.isError && (
          <ErrorNote message={serverVerdict(trace.error)} retry={() => void trace.refetch()} />
        )}

        {trace.isLoading && serial !== '' && <SkeletonRows rows={3} />}

        {serial !== '' && !trace.isLoading && !trace.isError && unit === null && (
          <p className="text-text-muted text-sm">
            No unit of yours carries that serial. Either the number belongs to something we never
            received, or this SKU is not tracked per unit.
          </p>
        )}

        {unit !== null && (
          <>
            <div className="border-border mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border px-3 py-2 text-sm">
              <span className="font-mono text-xs">{unit.serialBarcode}</span>
              <span className="text-text-muted">{unit.skuCode ?? unit.variantId}</span>
              <StockUnitStatusBadge status={unit.status} />
            </div>

            <Table>
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
                    <Td>{new Date(e.at).toLocaleString()}</Td>
                    <Td>
                      {/* The transition, not just the destination — a unit
                          that went picked → in stock came back off a
                          cancelled box, and that is the interesting part. */}
                      <span className="text-text-muted">
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
      </CardBody>
    </Card>
  );
}
