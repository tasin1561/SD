'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useToast } from '@skydrop/ui/components';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ParachuteProgress } from '@skydrop/ui/app/parachute-progress';
import { Select } from '@skydrop/ui/app/select';
import {
  useBulkBinTransfer,
  useMoveWholeBin,
  useWarehouseBins,
  useWarehouses,
  type WarehouseBin,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { NON_PICKABLE_BIN_TYPES as NON_PICKABLE } from '@/lib/bin-policy';
import { BinLinePicker } from './bin-line-picker';
import {
  Actions,
  AreaSection,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  PanelPad,
  mutationPhase,
} from '../../../inventory/_components/stock-kit';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Re-shelving.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The bins screen above lets you BUILD a layout. Nothing let you change
 * one. Both endpoints have been in the API since the bin-ops module
 * landed and neither had a caller, so re-organising a warehouse floor —
 * the ordinary act of "this rack is being emptied, everything moves to
 * B-02" — was impossible from any interface. The only alternative was
 * the inter-warehouse transfer form, one variant+batch at a time, which
 * is a considered correction rather than physical work.
 *
 * ── WHY TWO SHAPES, NOT ONE ──────────────────────────────────────────
 * On a floor the unit of work is either "this whole shelf goes over
 * there" — you pick the box up and carry it, and nobody enumerates what
 * was inside — or "here is the list off the re-organisation sheet". The
 * server expands the first into the second and runs both through the
 * same transactional mover, so they cannot behave differently.
 *
 * ── WHAT A MOVE IS NOT ───────────────────────────────────────────────
 * The batch never changes. A move answers WHERE, not WHAT: re-batching
 * would reorder FEFO picking and sever the goods-receipt link inbound
 * freight is attributed through. So a line is chosen whole — the batch
 * comes with the thing being moved and is never a separate decision.
 *
 * ── THE LINE IS PICKED, NOT TYPED (since 2026-10-01) ─────────────────
 * This asked for a seller id, a variant id and a batch id — three
 * uuids, in three monospace boxes, none of which any screen offered to
 * copy. See `bin-line-picker.tsx` for why one picker replaced three
 * boxes rather than three pickers replacing them.
 *
 * ── NOT BUILT HERE, DELIBERATELY ─────────────────────────────────────
 * Collapse (merge every bin into FLOOR) is a different act with a
 * different permission, a two-step emailed confirmation code and a
 * snapshot to restore from. It destroys the record of where everything
 * was and is meant to be hard to reach; putting it beside a routine
 * re-shelving button is exactly how it gets clicked by accident.
 *
 * It has its own screen at `/warehouse/collapse` since 2026-10-01, and
 * this panel LINKS to it — a link, not a button, and only for somebody
 * who already holds the permission. Before that it had no caller at all
 * outside the e2e suite, which meant the operation needed API access and
 * the backup it takes could be listed by nobody. Unreachable is not the
 * same as hard to reach, and the difference showed up as a restore path
 * that existed and could not be used.
 */

interface DraftLine {
  readonly key: number;
  /** `stock_levels` id — the picker's own value, never sent. */
  stockLevelId: string;
  sellerId: string;
  variantId: string;
  batchId: string;
  qty: string;
  sourceBinId: string;
  destBinId: string;
}

function emptyLine(key: number): DraftLine {
  return {
    key,
    stockLevelId: '',
    sellerId: '',
    variantId: '',
    batchId: '',
    qty: '',
    sourceBinId: '',
    destBinId: '',
  };
}

function binLabel(t: Translate<MessageKey>, b: WarehouseBin): string {
  return NON_PICKABLE.has(b.type)
    ? t('warehouseBinsBinOpsPanel.notPickable', { code: b.code, type: b.type })
    : b.code;
}

export function BinOpsPanel({
  warehouseId,
}: {
  /** Omit it and the panel resolves the warehouse itself, so it can be
   *  mounted standalone on the page as well as inside a screen that has
   *  already chosen one. */
  readonly warehouseId?: string;
}): ReactElement | null {
  const tr = useT();
  const t = useT();

  // COSMETIC (FE-2). The page is gated on warehouse.view; both endpoints
  // demand warehouse.manage. Without this, anyone who can read the floor
  // plan is offered two buttons the server will refuse.
  const mayManage = usePermission('warehouse.manage');
  // Cosmetic (FE-2): the collapse endpoints carry this key and refuse
  // regardless. It gates the LINK so somebody who can never use it is
  // not pointed at a screen that would bounce them.
  const mayCollapse = usePermission('warehouse.bins.collapse');

  const toast = useToast();
  const warehouses = useWarehouses();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  // Land on the first warehouse rather than making the operator choose
  // one when, as today, there is exactly one.
  const activeId = warehouseId ?? pickedWarehouse;
  const resolvedId = activeId || (warehouses.data?.[0]?.id ?? '');

  const bins = useWarehouseBins(resolvedId);
  const moveBin = useMoveWholeBin(resolvedId);
  const bulk = useBulkBinTransfer(resolvedId);

  const [error, setError] = useState<string | null>(null);
  const [sourceBinId, setSourceBinId] = useState('');
  const [destBinId, setDestBinId] = useState('');
  const [confirmMove, setConfirmMove] = useState(false);

  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<readonly DraftLine[]>([emptyLine(0)]);

  const binOptions = bins.data ?? [];
  const byId = useMemo(() => new Map(binOptions.map((b) => [b.id, b])), [binOptions]);

  const sameBin = sourceBinId !== '' && sourceBinId === destBinId;
  const canMove = sourceBinId !== '' && destBinId !== '' && !sameBin;

  function editLine(key: number, patch: Partial<DraftLine>): void {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setError(null);
  }

  /**
   * Choosing a different FROM bin CLEARS the product.
   *
   * The line that was picked belongs to the bin it was picked from; it
   * is a different row of `stock_levels` in another bin, or not there at
   * all. Carrying it over would submit a (seller, variant, batch) the
   * new source does not hold — refused by the server, but only after
   * somebody typed a quantity and pressed the button, and silently
   * wrong-looking until then.
   */
  function pickSource(key: number, sourceBinId: string): void {
    editLine(key, { sourceBinId, stockLevelId: '', sellerId: '', variantId: '', batchId: '' });
  }

  function addLine(): void {
    setLines((ls) => [...ls, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number): void {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }

  // Mirrors the server's own floors — ArrayMinSize(1), Min(1) on qty, and
  // "a line moves stock from a bin to itself" — so the operator is told
  // before submitting rather than after. The server still decides.
  const lineComplete = (l: DraftLine): boolean =>
    l.sellerId.trim() !== '' &&
    l.variantId.trim() !== '' &&
    l.batchId.trim() !== '' &&
    Number.isInteger(Number(l.qty)) &&
    Number(l.qty) >= 1 &&
    l.sourceBinId !== '' &&
    l.destBinId !== '' &&
    l.sourceBinId !== l.destBinId;

  const bulkReady = lines.length >= 1 && lines.every(lineComplete);
  const bulkUnits = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

  async function onMoveWholeBin(): Promise<void> {
    setError(null);
    try {
      const r = await moveBin.mutateAsync({ sourceBinId, destBinId });
      setConfirmMove(false);
      setSourceBinId('');
      setDestBinId('');
      // The counts come from the SERVER. It expanded the bin's contents;
      // we never knew what was in there, and guessing would report a
      // number nobody moved.
      toast.success(
        tr('warehouseBinsBinOpsPanel.movedUnitSAcrossLine', {
          unitsMoved: r.unitsMoved,
          linesMoved: r.linesMoved,
          value: byId.get(destBinId)?.code ?? tr('warehouseBinsBinOpsPanel.theDestinationBin'),
        }),
      );
    } catch (err) {
      setConfirmMove(false);
      setError(serverVerdict(err));
    }
  }

  async function onBulkTransfer(): Promise<void> {
    setError(null);
    try {
      const r = await bulk.mutateAsync(
        lines.map((l) => ({
          sellerId: l.sellerId.trim(),
          variantId: l.variantId.trim(),
          batchId: l.batchId.trim(),
          // A number, not the input's string: the DTO is @IsInt and the
          // API runs forbidNonWhitelisted with implicit conversion off
          // for anything it did not declare a @Type for.
          qty: Number(l.qty),
          sourceBinId: l.sourceBinId,
          destBinId: l.destBinId,
        })),
      );
      setLines([emptyLine(nextKey)]);
      setNextKey((k) => k + 1);
      toast.success(
        t('warehouseBinsBinOpsPanel.reShelvedUnitSAcross', {
          unitsMoved: r.unitsMoved,
          linesMoved: r.linesMoved,
        }),
      );
    } catch (err) {
      // Nothing was applied — the whole submission is one transaction, so
      // the list on screen is still exactly what needs to happen.
      setError(serverVerdict(err));
    }
  }

  if (!mayManage) return null;

  const sourceCode = byId.get(sourceBinId)?.code ?? '—';
  const destCode = byId.get(destBinId)?.code ?? '—';

  return (
    <AreaSection
      title={t('warehouseBinsBinOpsPanel.moveStockBetweenBins')}
      note={t('warehouseBinsBinOpsPanel.reShelvingTheBatchNever')}
    >
      {warehouseId === undefined && (warehouses.data?.length ?? 0) > 1 && (
        <FieldGrid columns={2}>
          <Select
            id="binops-wh"
            label={t('warehouseBinsBinOpsPanel.warehouse')}
            value={resolvedId}
            onChange={(e) => {
              setPickedWarehouse(e.target.value);
              setSourceBinId('');
              setDestBinId('');
              setError(null);
            }}
          >
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </Select>
        </FieldGrid>
      )}

      {error !== null && <InlineError message={error} />}

      {/* ── Whole bin ─────────────────────────────────────────────── */}
      <Panel
        title={t('warehouseBinsBinOpsPanel.emptyOneBinIntoAnother')}
        subtitle={t('warehouseBinsBinOpsPanel.everythingCurrentlyStandingInThe')}
      >
        <FieldGrid columns={2}>
          <Select
            id="binops-src"
            label={t('warehouseBinsBinOpsPanel.from')}
            value={sourceBinId}
            onChange={(e) => {
              setSourceBinId(e.target.value);
              setError(null);
            }}
          >
            <option value="">{t('warehouseBinsBinOpsPanel.choose')}</option>
            {binOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {binLabel(t, b)}
              </option>
            ))}
          </Select>
          <Select
            id="binops-dst"
            label={t('warehouseBinsBinOpsPanel.to')}
            value={destBinId}
            onChange={(e) => {
              setDestBinId(e.target.value);
              setError(null);
            }}
          >
            <option value="">{t('warehouseBinsBinOpsPanel.choose')}</option>
            {binOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {binLabel(t, b)}
              </option>
            ))}
          </Select>
        </FieldGrid>

        <div aria-live="polite">
          {sameBin ? (
            <Note tone="warn">{t('warehouseBinsBinOpsPanel.sourceAndDestinationAreThe')}</Note>
          ) : destBinId !== '' && NON_PICKABLE.has(byId.get(destBinId)?.type ?? '') ? (
            <Note tone="bad">
              {t('warehouseBinsBinOpsPanel.isNotPickableStockMoved', {
                code: byId.get(destBinId)?.code ?? '',
              })}
            </Note>
          ) : (
            <Note tone="faint">{t('warehouseBinsBinOpsPanel.theSourceBinSFloor')}</Note>
          )}
        </div>

        <Actions>
          <AsyncButton
            variant="primary"
            size="md"
            icon={<ArrowRightLeft size={16} />}
            state={mutationPhase(moveBin)}
            labels={{
              idle: t('warehouseBinsBinOpsPanel.moveTheWholeBin'),
              busy: t('warehouseBinsBinOpsPanel.moving'),
            }}
            disabled={!canMove || moveBin.isPending}
            onClick={() => setConfirmMove(true)}
          />
        </Actions>
      </Panel>

      {/* ── Line list ─────────────────────────────────────────────── */}
      <Panel
        flush
        title={t('warehouseBinsBinOpsPanel.applyAListOfMoves')}
        subtitle={t('warehouseBinsBinOpsPanel.allOfItCommitsOr')}
      >
        {/* CARDS ON A PHONE, like the other 98 tables. `responsive={false}`
            crammed four columns of form controls into a 314px table at
            320px: the From and To selects came out 12px and 16px wide,
            which is not a control anybody can use. The card layout was
            written for exactly this — its own comment names "a role
            <select>" as a value that drops to its own line. */}
        <Table>
          <THead>
            <Tr>
              <Th>{t('warehouseBinsBinOpsPanel.from')}</Th>
              <Th>{t('warehouseBinsBinOpsPanel.product')}</Th>
              <Th>{t('warehouseBinsBinOpsPanel.qty')}</Th>
              <Th>{t('warehouseBinsBinOpsPanel.to')}</Th>
              <Th> </Th>
            </Tr>
          </THead>
          <TBody>
            {lines.map((l) => (
              <Tr key={l.key}>
                <Td>
                  <Select
                    value={l.sourceBinId}
                    aria-label={t('warehouseBinsBinOpsPanel.fromBin')}
                    onChange={(e) => pickSource(l.key, e.target.value)}
                  >
                    <option value="">{t('warehouseBinsBinOpsPanel.choose')}</option>
                    {binOptions.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <BinLinePicker
                    binId={l.sourceBinId}
                    value={l.stockLevelId}
                    onChange={(picked) =>
                      editLine(
                        l.key,
                        picked === null
                          ? { stockLevelId: '', sellerId: '', variantId: '', batchId: '' }
                          : picked,
                      )
                    }
                  />
                </Td>
                <Td>
                  <input
                    className="stk-input sk-figure"
                    value={l.qty}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    aria-label={t('warehouseBinsBinOpsPanel.quantity')}
                    onChange={(e) => editLine(l.key, { qty: e.target.value })}
                  />
                </Td>
                <Td>
                  <Select
                    value={l.destBinId}
                    aria-label={t('warehouseBinsBinOpsPanel.toBin')}
                    onChange={(e) => editLine(l.key, { destBinId: e.target.value })}
                  >
                    <option value="">{t('warehouseBinsBinOpsPanel.choose')}</option>
                    {binOptions.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={lines.length === 1}
                    onClick={() => removeLine(l.key)}
                  >
                    {t('warehouseBinsBinOpsPanel.remove')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>

        <PanelPad>
          {bulk.isPending && (
            <ParachuteProgress
              label={t('warehouseBinsBinOpsPanel.applyingLineS', { length: lines.length })}
              detail={t('warehouseBinsBinOpsPanel.unitSAreMovingIn', { bulkUnits })}
            />
          )}
          <Actions>
            <Button variant="ghost" size="md" icon={<Plus size={16} />} onClick={addLine}>
              {t('warehouseBinsBinOpsPanel.addALine')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={mutationPhase(bulk)}
              labels={{
                idle: t('warehouseBinsBinOpsPanel.applyLineS', { length: lines.length }),
                busy: t('warehouseBinsBinOpsPanel.applying'),
              }}
              disabled={!bulkReady || bulk.isPending}
              onClick={() => void onBulkTransfer()}
            />
            <span className="stk-faint stk-note">
              {bulkReady
                ? t('warehouseBinsBinOpsPanel.unitSWillMove', { bulkUnits })
                : t('warehouseBinsBinOpsPanel.everyLineNeedsAClient')}
            </span>
          </Actions>
        </PanelPad>
      </Panel>

      <ConfirmDialog
        open={confirmMove}
        onOpenChange={(next) => {
          if (!next) setConfirmMove(false);
        }}
        title={tr('warehouseBinsBinOpsPanel.moveEverythingIn', {
          value: byId.get(sourceBinId)?.code ?? tr('warehouseBinsBinOpsPanel.thisBin'),
        })}
        entity={`${sourceCode} → ${destCode}`}
        entityIsIdentifier
        consequence={t('warehouseBinsBinOpsPanel.everyUnitStandingInThe')}
        confirmLabel={t('warehouseBinsBinOpsPanel.moveIt')}
        onConfirm={onMoveWholeBin}
      >
        <Note>{t('warehouseBinsBinOpsPanel.doThisOnceTheGoods')}</Note>
      </ConfirmDialog>

      {/* The way in to the destructive one. A LINK and not a button, at
          the very bottom, and only for somebody who already holds the
          permission — reachable on the day it is needed without ever
          being a thing a hand lands on while re-shelving. */}
      {mayCollapse && (
        <Note>
          {richMessage(t('warehouseBinsBinOpsPanel.abandoningThisWarehouseSShelving'), {
            link: (
              <Link href="/warehouse/collapse" className="stk-link">
                {t('warehouseBinsBinOpsPanel.collapseItsBinsIntoFloor')}
              </Link>
            ),
          })}
        </Note>
      )}
    </AreaSection>
  );
}
