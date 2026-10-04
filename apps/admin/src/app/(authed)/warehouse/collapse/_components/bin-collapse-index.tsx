'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, Archive, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { Table, TBody, Td, Th, THead, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useWarehouses } from '@/lib/api-hooks';
import {
  useBinSnapshots,
  useConfirmBinCollapse,
  useRequestBinCollapse,
  useRestoreBinSnapshot,
  type BinLayoutSnapshot,
  type CollapseResult,
  type RequestCollapseResult,
  type RestoreResult,
} from '@/lib/bin-collapse-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  Actions,
  AreaPage,
  AreaSection,
  Callout,
  Code,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  PanelPad,
  StockPageHeader,
} from '../../../inventory/_components/stock-kit';

/** The server's own floors, mirrored for the counter and nothing else. */
const MIN_REASON_LEN = 30;

/**
 * Collapsing a warehouse's bins — and putting the layout back.
 *
 * ── WHY THIS SCREEN EXISTS ───────────────────────────────────────────
 * `BinCollapseService` shipped with four endpoints and no caller
 * outside the e2e suite. So one of the most destructive operations in
 * the product — merge every bin into FLOOR, after which where anything
 * WAS exists only in a snapshot — could be performed only by somebody
 * with API access, and the snapshot it takes could only be listed the
 * same way. The second half is the worse one: a backup nobody can see
 * is a backup nobody trusts, and a restore nobody knows about is one
 * nobody reaches for on the day it matters.
 *
 * ── WHAT THE UI'S JOB IS ─────────────────────────────────────────────
 * Convey the gravity, then get out of the way (the god-mode override
 * panel is the worked example). Escalating chrome — a red panel, a
 * 30-character reason with a live counter, the pre-count of what would
 * move, an emailed six-digit code, the warehouse's own code typed
 * exactly — and then FE-2: every one of those is a SERVER gate. The
 * page never pre-empts one with a client-side mirror; where the server
 * refuses, its `[CODE] message` is shown verbatim.
 *
 * The counter and the typed-code comparison look like enforcement and
 * are not. They exist so a person can see they have not finished, not
 * so the browser can decide they have.
 *
 * ── WHY IT IS ITS OWN ROUTE AND NOT A PANEL ON /warehouse/bins ───────
 * `BinOpsPanel`'s own note gives the reason and this screen honours it:
 * "putting it beside a routine re-shelving button is exactly how it
 * gets clicked by accident." It is linked FROM there, once, as a link
 * rather than a button, and it is deliberately not in the sidebar.
 */
export function BinCollapseIndex(): ReactElement {
  const mayCollapse = usePermission('warehouse.bins.collapse');
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');

  const active = useMemo(
    () => (warehouses.data ?? []).find((w) => w.id === warehouseId) ?? null,
    [warehouses.data, warehouseId],
  );

  return (
    <AreaPage>
      <StockPageHeader
        title="Collapse a warehouse's bins"
        subtitle={
          <>
            Merges every shelf into <Code>FLOOR</Code>. A backup of the layout is taken first, and
            the goods keep selling while it is being put back — so a restore is a head start, not a
            rewind.
          </>
        }
      />

      <AreaSection title="Which warehouse">
        <Panel>
          <PanelPad>
            <FieldGrid>
              <Select
                id="collapse-warehouse"
                label="Warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={warehouses.isPending}
              >
                <option value="">Choose a warehouse…</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.code}
                  </option>
                ))}
              </Select>
            </FieldGrid>
          </PanelPad>
        </Panel>
      </AreaSection>

      {warehouseId === '' ? null : (
        <>
          <SnapshotList warehouseId={warehouseId} mayRestore={mayCollapse} />
          {/* Cosmetic only (FE-2): the endpoints carry
              `warehouse.bins.collapse` and refuse regardless of what is
              on screen. Hidden rather than disabled because a control
              somebody can never use is noise on a page whose whole job
              is to be read carefully. */}
          {mayCollapse && active !== null ? (
            <DangerZone warehouseId={warehouseId} warehouseCode={active.code} />
          ) : null}
        </>
      )}
    </AreaPage>
  );
}

// ── the backups ───────────────────────────────────────────────────────

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Whole days from now until `iso`, floored; negative once it has passed. */
function daysUntil(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function SnapshotList({
  warehouseId,
  mayRestore,
}: {
  readonly warehouseId: string;
  readonly mayRestore: boolean;
}): ReactElement {
  const snapshots = useBinSnapshots(warehouseId);
  const restore = useRestoreBinSnapshot(warehouseId);
  const [confirming, setConfirming] = useState<BinLayoutSnapshot | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <AreaSection title="Layout backups">
      <Panel>
        <PanelPad>
          <Note>
            One is taken automatically before every collapse, BEFORE anything moves — a crash
            between the two leaves a complete backup and an untouched warehouse. They are swept once
            they expire; how long they are kept is the{' '}
            <Code>ops.bin_snapshot_retention_months</Code> setting, and each row below shows the
            date its own copy goes.
          </Note>

          {error !== null && <InlineError message={error} />}

          {result !== null && (
            <Callout tone="info">
              Put back {result.restoredLines} line(s).
              {result.skippedLines.length > 0 ? (
                <>
                  {' '}
                  {result.skippedLines.length} could not be:
                  <ul>
                    {result.skippedLines.map((s) => (
                      <li key={`${s.binCode}:${s.variantId}`}>
                        <Code>{s.binCode}</Code> — {s.why}
                      </li>
                    ))}
                  </ul>
                  Stock sells between a collapse and a restore, so this is expected rather than a
                  fault: the goods that are still here went back where they were.
                </>
              ) : null}
            </Callout>
          )}

          <Table>
            <THead>
              <Tr>
                <Th>Taken</Th>
                <Th>Why</Th>
                <Th>Lines</Th>
                <Th>Units</Th>
                <Th>Kept until</Th>
                <Th>{''}</Th>
              </Tr>
            </THead>
            <TBody>
              {snapshots.isPending ? (
                <SkeletonRows rows={3} cols={6} />
              ) : (snapshots.data ?? []).length === 0 ? (
                <TableEmpty colSpan={6}>
                  No backup has been taken for this warehouse — nothing here has been collapsed.
                </TableEmpty>
              ) : (
                (snapshots.data ?? []).map((s) => {
                  const left = daysUntil(s.expiresAt);
                  return (
                    <Tr key={s.id}>
                      <Td>{fmt(s.createdAt)}</Td>
                      <Td>{s.reason}</Td>
                      <Td className="sk-figure">{s.lineCount}</Td>
                      <Td className="sk-figure">{s.totalQty}</Td>
                      <Td>
                        {fmt(s.expiresAt)}
                        <div className="stk-sub">
                          {left < 0
                            ? 'expired — the sweep will remove it'
                            : left === 0
                              ? 'expires today'
                              : `${String(left)} day(s) left`}
                        </div>
                      </Td>
                      <Td>
                        {s.restoredAt !== null ? (
                          <span className="stk-sub">Restored {fmt(s.restoredAt)}</span>
                        ) : mayRestore ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<RotateCcw size={14} />}
                            onClick={() => {
                              setResult(null);
                              setError(null);
                              setConfirming(s);
                            }}
                          >
                            Put the layout back
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        </PanelPad>
      </Panel>

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o && !restore.isPending) setConfirming(null);
        }}
        locked={restore.isPending}
        size="md"
        icon={<Archive size={18} />}
        title="Put this layout back?"
        description="Best-effort, line by line. Anything that has sold, moved or been picked since the collapse stays where it is and is listed as skipped — this is a head start, not a rewind."
        footer={
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirming(null)}
              disabled={restore.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={restore.isPending}
              onClick={() => {
                const target = confirming;
                if (target === null) return;
                void (async () => {
                  setError(null);
                  try {
                    setResult(await restore.mutateAsync({ snapshotId: target.id }));
                    setConfirming(null);
                  } catch (err) {
                    setError(serverVerdict(err, 'The restore failed.'));
                  }
                })();
              }}
            >
              Put it back
            </Button>
          </DialogFooter>
        }
      >
        {confirming !== null && (
          <p>
            {confirming.lineCount} line(s), {confirming.totalQty} unit(s), taken{' '}
            {fmt(confirming.createdAt)}.
          </p>
        )}
        {error !== null && <InlineError message={error} />}
      </Dialog>
    </AreaSection>
  );
}

// ── the collapse itself ───────────────────────────────────────────────

function DangerZone({
  warehouseId,
  warehouseCode,
}: {
  readonly warehouseId: string;
  readonly warehouseCode: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<CollapseResult | null>(null);

  return (
    <AreaSection title="Collapse">
      <Panel tone="critical">
        <PanelPad>
          <Callout tone="bad">
            <strong>This merges every shelf in the warehouse into FLOOR.</strong> Where each thing
            was is then only in the backup above. Bins a picker can never reach are left alone —
            hold, damaged, quarantine, and goods still in transit between two of our warehouses.
            Those are about not selling stock rather than finding it, and sweeping them into FLOOR
            would put broken or not-yet-arrived goods into the pickable pool.
          </Callout>
          <Note>
            Two steps, and the first moves nothing: it reports how many bins and units WOULD merge
            and emails a six-digit code to you. You then type that code and this warehouse&rsquo;s
            own code, <Code>{warehouseCode}</Code>, exactly.
          </Note>

          {done !== null && (
            <Callout tone="info">
              Collapsed {done.binsCollapsed} bin(s): {done.rowsMoved} stock line(s),{' '}
              {done.unitsMoved} unit(s) now in FLOOR. The backup is in the list above and can be put
              back from there.
            </Callout>
          )}

          <Actions>
            <Button
              variant="destructive"
              icon={<ShieldAlert size={14} />}
              onClick={() => {
                setDone(null);
                setOpen(true);
              }}
            >
              Collapse this warehouse&rsquo;s bins
            </Button>
          </Actions>
        </PanelPad>
      </Panel>

      <CollapseDialog
        open={open}
        onOpenChange={setOpen}
        warehouseId={warehouseId}
        warehouseCode={warehouseCode}
        onDone={setDone}
      />
    </AreaSection>
  );
}

/**
 * The two-stage dialog: state the reason and see what it would cost,
 * then prove it is you.
 *
 * Staged rather than one long form because the numbers only exist after
 * step one. A form asking for a confirmation code before telling you
 * what you are confirming is asking somebody to agree to an unknown.
 */
export function CollapseDialog({
  open,
  onOpenChange,
  warehouseId,
  warehouseCode,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly onDone: (result: CollapseResult) => void;
}): ReactElement {
  const request = useRequestBinCollapse(warehouseId);
  const confirm = useConfirmBinCollapse(warehouseId);

  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [challenge, setChallenge] = useState<RequestCollapseResult | null>(null);
  const [code, setCode] = useState('');
  const [typedCode, setTypedCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Everything resets when the dialog re-opens: a half-finished
  // challenge left in state is how the wrong warehouse gets collapsed.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setAck(false);
    setChallenge(null);
    setCode('');
    setTypedCode('');
    setError(null);
  }, [open, warehouseId]);

  const busy = request.isPending || confirm.isPending;
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= MIN_REASON_LEN;
  const codeOk = code.trim().length === 6;
  const typedOk = typedCode === warehouseCode;

  async function askForCode(): Promise<void> {
    setError(null);
    try {
      setChallenge(await request.mutateAsync({ reason: reason.trim() }));
    } catch (err) {
      setError(serverVerdict(err, 'Could not start the collapse.'));
    }
  }

  async function doCollapse(): Promise<void> {
    if (challenge === null) return;
    setError(null);
    try {
      const result = await confirm.mutateAsync({
        challengeId: challenge.challengeId,
        code: code.trim(),
        typedWarehouseCode: typedCode,
      });
      onDone(result);
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err, 'The collapse was refused.'));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
      }}
      locked={busy}
      size="lg"
      tone="critical"
      icon={<ShieldAlert size={18} />}
      title="Collapse this warehouse's bins"
      description="Every shelf merges into FLOOR. A backup is taken first; goods sell while it is being put back, so a restore recovers what is still here and no more."
      footer={
        challenge === null ? (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={request.isPending}
              disabled={!reasonOk || !ack || busy}
              onClick={() => void askForCode()}
              title={
                !reasonOk
                  ? `Give a reason of at least ${String(MIN_REASON_LEN)} characters`
                  : !ack
                    ? 'Acknowledge what a collapse destroys'
                    : undefined
              }
            >
              Show me what this would move
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setTypedCode('');
              }}
              disabled={busy}
            >
              ← Back
            </Button>
            <Button
              variant="destructive"
              icon={<ShieldAlert size={14} />}
              loading={confirm.isPending}
              disabled={!codeOk || !typedOk || busy}
              onClick={() => void doCollapse()}
            >
              Collapse {String(challenge.binsAffected)} bin(s)
            </Button>
          </DialogFooter>
        )
      }
    >
      {challenge === null ? (
        <>
          <Callout tone="bad">
            <AlertTriangle size={14} aria-hidden /> Where every item sits is about to stop being
            recorded. Pickers will find stock by searching FLOOR until the shelving is laid out and
            put away again.
          </Callout>
          <TextArea
            id="collapse-reason"
            label="Why"
            requiredMark
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            placeholder="What is happening to this warehouse, and why the layout is being abandoned rather than re-shelved."
            hint="Stored on the backup and on the audit trail. It is the only explanation anyone will have later."
            after={
              <span className="sk-figure" data-ok={reasonOk ? '1' : undefined}>
                {reasonLen} / {MIN_REASON_LEN} min
              </span>
            }
          />
          <Checkbox
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            disabled={busy}
            label={
              <>
                I understand this destroys the record of where everything is, and that a restore
                only recovers stock that has not moved or sold in the meantime.
              </>
            }
          />
        </>
      ) : (
        <>
          <Callout tone="bad">
            <strong>
              {challenge.binsAffected} bin(s) holding {challenge.unitsAffected} unit(s)
            </strong>{' '}
            would merge into FLOOR.
          </Callout>
          <Note>
            A six-digit code has been emailed to <Code>{challenge.sentToEmail}</Code>. It is good
            until {fmt(challenge.expiresAt)}.
          </Note>
          <FieldGrid>
            <TextField
              id="collapse-code"
              label="The code from your email"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000000"
            />
            <TextField
              id="collapse-warehouse-code"
              label={`Type ${warehouseCode} to confirm`}
              aria-label={`Type ${warehouseCode} to confirm`}
              value={typedCode}
              onChange={(e) => setTypedCode(e.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={warehouseCode}
            />
          </FieldGrid>
        </>
      )}

      {/* FE-2: the server's own words, never our paraphrase of them. */}
      {error !== null && <InlineError message={error} />}
    </Dialog>
  );
}
