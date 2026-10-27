'use client';

import { useState, type ReactElement } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { statusLabel, stockUnitStatusKind } from '@skydrop/ui/status';
import { serverVerdict } from '@/lib/server-verdict';
import { useUnitTrace, useUnitTriage } from '@/lib/ops-hooks';
import { InlineError, Note, Panel, Stack } from '../../inventory/_components/stock-kit';
import './units.css';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
  const t = useT();
  const locale = useLocale();
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
    <Panel
      title={t('inventoryUnitsUnitTracePanel.traceASerial')}
      subtitle={t('inventoryUnitsUnitTracePanel.scanOrTypeTheNumber')}
    >
      <div className="unit-trace__form">
        <Select
          label={t('inventoryUnitsUnitTracePanel.client')}
          requiredMark
          hint={t('inventoryUnitsUnitTracePanel.aSerialIsOnlyUnique')}
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
        >
          <option value="">{t('inventoryUnitsUnitTracePanel.choose')}</option>
          {sellers.map((s) => (
            <option key={s.sellerId} value={s.sellerId}>
              {s.companyName ?? s.sellerId}
            </option>
          ))}
        </Select>
        <label className="unit-trace__serial">
          <span className="stk-field-label">
            {richMessage(t('inventoryUnitsUnitTracePanel.serial'), {
              span: <span aria-hidden>*</span>,
            })}
          </span>
          <input
            className="stk-input"
            data-mono="1"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            // A barcode gun types the number and presses Enter.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t('inventoryUnitsUnitTracePanel.scanOrType')}
          />
        </label>
        <Button
          variant="primary"
          size="md"
          icon={<ScanLine size={16} />}
          disabled={sellerId === '' || typed.trim() === ''}
          onClick={submit}
        >
          {t('inventoryUnitsUnitTracePanel.trace')}
        </Button>
      </div>

      {trace.isError && (
        <InlineError message={serverVerdict(trace.error)} retry={() => void trace.refetch()} />
      )}

      {trace.isLoading && searched && <SkeletonRows rows={3} cols={5} />}

      {searched && !trace.isLoading && unit === null && trace.isError === false && (
        <Note>{t('inventoryUnitsUnitTracePanel.noUnitWithThatSerial')}</Note>
      )}

      {unit !== null && (
        <Stack tight>
          <div className="unit-trace__unit">
            <span className="sk-ident">{unit.serialBarcode}</span>
            <span className="stk-muted">{unit.skuCode ?? unit.variantId}</span>
            <StatusChip
              size="sm"
              kind={stockUnitStatusKind(unit.status)}
              label={statusLabel(unit.status, locale)}
            />
            <span className="stk-faint sk-figure">
              {t('inventoryUnitsUnitTracePanel.hInThisStatus', {
                hoursInStatus: unit.hoursInStatus,
              })}
            </span>
          </div>

          <Table>
            <THead>
              <Tr>
                <Th>{t('inventoryUnitsUnitTracePanel.when')}</Th>
                <Th>{t('inventoryUnitsUnitTracePanel.moved')}</Th>
                <Th>{t('inventoryUnitsUnitTracePanel.gate')}</Th>
                <Th>{t('inventoryUnitsUnitTracePanel.parcel')}</Th>
                <Th>{t('inventoryUnitsUnitTracePanel.note')}</Th>
              </Tr>
            </THead>
            <TBody>
              {events.map((e, i) => (
                <Tr key={`${e.at}-${i}`}>
                  <Td className="sk-figure stk-nowrap">{new Date(e.at).toLocaleString()}</Td>
                  <Td>
                    {/* The transition, not just where it ended up — a
                        unit that went PICKED → IN_STOCK came back off a
                        cancelled box, and that is the interesting part. */}
                    <span className="stk-muted">
                      {e.fromStatus === null ? '—' : e.fromStatus.toLowerCase().replace(/_/g, ' ')}
                    </span>{' '}
                    → {e.toStatus.toLowerCase().replace(/_/g, ' ')}
                  </Td>
                  <Td>{e.gate}</Td>
                  <Td>
                    {e.shipmentId === null ? (
                      '—'
                    ) : (
                      <span className="sk-ident">{e.shipmentId.slice(0, 8)}</span>
                    )}
                  </Td>
                  <Td>{e.note ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Stack>
      )}
    </Panel>
  );
}
