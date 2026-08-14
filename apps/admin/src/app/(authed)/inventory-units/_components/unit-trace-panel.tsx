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
  Select,
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
import { useUnitTrace, useUnitTriage } from '@/lib/ops-hooks';

/**
 * Where one unit has been.
 *
 * The triage table above answers "which units look wrong". This answers
 * the other question, the one somebody asks while physically holding a
 * returned item with a barcode on it: what is this, whose is it, and
 * where has it already been. No other screen can answer it — the
 * endpoint shipped with R4 and had no caller, which only began to
 * matter once a seller could actually switch a SKU to STRICT.
 *
 * The seller has to be chosen because a serial is only unique WITHIN a
 * seller: `stock_units` is keyed on `(sellerId, serialBarcode)`, so two
 * companies can legitimately print the same number. Guessing which one
 * meant it would eventually show somebody another company's unit.
 */
export function UnitTracePanel(): ReactElement {
  const triage = useUnitTriage();
  const [sellerId, setSellerId] = useState('');
  const [typed, setTyped] = useState('');
  const [serial, setSerial] = useState('');

  const trace = useUnitTrace(sellerId, serial);
  const sellers = triage.data?.sellers ?? [];

  function submit(): void {
    setSerial(typed.trim());
  }

  const unit = trace.data?.unit ?? null;
  const events = trace.data?.events ?? [];
  const searched = serial !== '' && sellerId !== '';

  return (
    <Card className="mt-4">
      <CardHeader
        title="Trace a serial"
        subtitle="Scan or type the number on the item. Its whole history, in the order it happened."
      />
      <CardBody>
        <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <FormField label="Seller" hint="A serial is only unique within one company." required>
            <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Choose…</option>
              {sellers.map((s) => (
                <option key={s.sellerId} value={s.sellerId}>
                  {s.companyName ?? s.sellerId}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Serial" required>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              // A barcode gun types the number and presses Enter.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Scan or type"
            />
          </FormField>
          <Button
            variant="primary"
            size="md"
            disabled={sellerId === '' || typed.trim() === ''}
            onClick={submit}
          >
            Trace
          </Button>
        </div>

        {trace.isError && (
          <ErrorNote message={serverVerdict(trace.error)} retry={() => void trace.refetch()} />
        )}

        {trace.isLoading && searched && <SkeletonRows rows={3} />}

        {searched && !trace.isLoading && unit === null && trace.isError === false && (
          <p className="text-text-muted text-sm">
            No unit with that serial belongs to this seller. Either it is another company&apos;s, or
            it was never received as a tracked unit.
          </p>
        )}

        {unit !== null && (
          <>
            <div className="border-border mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border px-3 py-2 text-sm">
              <span className="font-mono text-xs">{unit.serialBarcode}</span>
              <span className="text-text-muted">{unit.skuCode ?? unit.variantId}</span>
              <StockUnitStatusBadge status={unit.status} />
              <span className="text-text-faint text-xs">{unit.hoursInStatus}h in this status</span>
            </div>

            <Table>
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>Moved</Th>
                  <Th>Gate</Th>
                  <Th>Parcel</Th>
                  <Th>Note</Th>
                </Tr>
              </THead>
              <TBody>
                {events.map((e, i) => (
                  <Tr key={`${e.at}-${i}`}>
                    <Td>{new Date(e.at).toLocaleString()}</Td>
                    <Td>
                      {/* The transition, not just where it ended up — a
                          unit that went PICKED → IN_STOCK came back off a
                          cancelled box, and that is the interesting part. */}
                      <span className="text-text-muted">
                        {e.fromStatus === null
                          ? '—'
                          : e.fromStatus.toLowerCase().replace(/_/g, ' ')}
                      </span>{' '}
                      → {e.toStatus.toLowerCase().replace(/_/g, ' ')}
                    </Td>
                    <Td>{e.gate}</Td>
                    <Td>
                      {e.shipmentId === null ? (
                        '—'
                      ) : (
                        <span className="font-mono text-xs">{e.shipmentId.slice(0, 8)}</span>
                      )}
                    </Td>
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
