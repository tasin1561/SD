'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { serverVerdict } from '@/lib/server-verdict';
import { NON_PICKABLE_BIN_TYPES as NON_PICKABLE } from '@/lib/bin-policy';
import {
  useRtoPutaway,
  useRtoPutawayPending,
  useWarehouseBins,
  type RtoPutawayPending,
} from '@/lib/api-hooks';
import '../../_components/benches.css';

/**
 * Shelving returned goods an OLDER finalise left in the returns hold.
 *
 * ── WHY THIS SCREEN STILL EXISTS (WMS-8e, 2026-09-14) ─────────────────
 * Until 14 Sep 2026 finalising a return put restocked items into an
 * RTO_HOLD bin and this panel was the step that made them sellable.
 * Since WMS-8e the hold holds returns received and NOT yet decided, and
 * "Put back in stock" moves the unit straight to a sellable bin at
 * finalise — so a return finalised now never appears here. What can
 * still appear is a unit an earlier finalise left in hold: availability
 * ignores hold bins (INV-3), so until somebody shelves it, it is on hand
 * and cannot be sold. The server offers only those, and never a return
 * that is still waiting for its decision.
 *
 * ── THE SUGGESTION IS THE POINT ──────────────────────────────────────
 * The server proposes a bin — the one the item was picked from, else
 * where that SKU currently lives in this building. It is pre-selected
 * because it is right most of the time, and it is still a dropdown
 * because the shelf may have been re-purposed, or the parcel may have
 * come back to a different warehouse entirely. Suggesting is not
 * deciding.
 *
 * Hold, damaged and quarantine bins are filtered OUT of the choices:
 * moving goods from one hold bin to another looks like progress and
 * changes nothing. The server refuses them too — this only keeps the
 * operator from having to find that out.
 */

const REASON_LABEL: Record<string, string> = {
  PICKED_FROM: 'picked from here',
  RECENT_LOCATION: 'where this SKU lives',
};

export function PutawayPanel({ shipmentId }: { readonly shipmentId: string }): ReactElement | null {
  const toast = useToast();
  const pending = useRtoPutawayPending(shipmentId);
  const putaway = useRtoPutaway();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rows: ReadonlyArray<RtoPutawayPending> = useMemo(() => pending.data ?? [], [pending.data]);

  // Every row in one parcel is in the same building, so one bin list serves.
  const warehouseId = rows[0]?.warehouseId ?? '';
  const bins = useWarehouseBins(warehouseId);

  const shelvable = useMemo(
    () => (bins.data ?? []).filter((b) => !NON_PICKABLE.has(b.type)),
    [bins.data],
  );

  // Pre-select the server's suggestion once the rows arrive, without
  // stamping over a choice the operator has already made.
  useEffect(() => {
    if (rows.length === 0) return;
    setChoices((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.shipmentItemId] === undefined && r.suggestedBinId !== null) {
          next[r.shipmentItemId] = r.suggestedBinId;
        }
      }
      return next;
    });
  }, [rows]);

  if (pending.isLoading) return null;
  // Nothing in hold means nothing to shelve — an empty panel here would
  // read as a step somebody forgot rather than one that does not apply.
  if (rows.length === 0) return null;

  const ready = rows.filter((r) => (choices[r.shipmentItemId] ?? '') !== '');
  const allChosen = ready.length === rows.length;

  async function onShelve(): Promise<boolean> {
    setError(null);
    try {
      const result = await putaway.mutateAsync({
        shipmentId,
        lines: ready.map((r) => ({
          shipmentItemId: r.shipmentItemId,
          destBinId: choices[r.shipmentItemId] as string,
        })),
      });
      toast.success(
        `${result.movedCount} line${result.movedCount === 1 ? '' : 's'} shelved — now sellable.`,
      );
      setChoices({});
      return true;
    } catch (err) {
      // FE-2: the server's refusal, verbatim. It knows things this
      // screen does not — a bin deleted since the list was fetched, a
      // line already shelved by somebody else.
      setError(serverVerdict(err));
      return false;
    }
  }

  const binCode = (id: string): string =>
    shelvable.find((b) => b.id === id)?.code ??
    (bins.data ?? []).find((b) => b.id === id)?.code ??
    id;

  return (
    <section className="wh-card wh-stack">
      <div className="wh-row wh-row--between">
        <h2 className="wh-title">
          In hold — not yet sellable (<span className="sk-figure">{rows.length}</span>)
        </h2>
        <span className="wh-faint">
          An earlier version of finalise left these in the returns hold. They stay unsellable until
          they are on a shelf — returns finalised now go straight back into stock.
        </span>
      </div>

      {error !== null && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      {bins.isError && (
        <div role="alert" className="wh-alert">
          Could not load bins for this warehouse — {bins.error?.message ?? 'unknown error'}.
        </div>
      )}

      <div className="wh-stack wh-stack--tight">
        {rows.map((r) => {
          const chosen = choices[r.shipmentItemId] ?? '';
          const isSuggestion = chosen !== '' && chosen === r.suggestedBinId;
          return (
            <div key={r.shipmentItemId} className="wh-item">
              <div className="wh-fields" data-cols="putaway">
                <div className="wh-min0">
                  <div className="wh-item__name">{r.productName}</div>
                  <div className="wh-item__sub">
                    <span className="sk-ident">{r.skuCode}</span> ·{' '}
                    <span className="sk-figure">
                      {r.quantity} unit{r.quantity === 1 ? '' : 's'}
                    </span>{' '}
                    · in <span className="sk-ident">{r.holdBinCode}</span>
                  </div>
                </div>

                <div className="wh-faint">
                  {r.suggestedBinCode !== null && r.suggestionReason !== null ? (
                    <span>
                      suggested <span className="sk-ident">{r.suggestedBinCode}</span>{' '}
                      <span>({REASON_LABEL[r.suggestionReason] ?? r.suggestionReason})</span>
                    </span>
                  ) : (
                    // Said out loud rather than shown as an empty dropdown:
                    // this SKU has never been here before.
                    <span>no suggestion — pick a shelf</span>
                  )}
                </div>

                <Select
                  label="Shelf"
                  aria-label={`Shelf for ${r.skuCode}`}
                  value={chosen}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setChoices((prev) => ({ ...prev, [r.shipmentItemId]: e.target.value }))
                  }
                  {...(isSuggestion ? { hint: 'Suggested shelf' } : {})}
                >
                  <option value="">Choose a shelf…</option>
                  {shelvable.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.id === r.suggestedBinId ? ' — suggested' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="wh-row">
        <Button
          variant="primary"
          size="md"
          disabled={putaway.isPending || ready.length === 0}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          {putaway.isPending
            ? 'Shelving…'
            : allChosen
              ? `Shelve all ${rows.length}`
              : `Shelve ${ready.length} of ${rows.length}`}
        </Button>
        {!allChosen && ready.length > 0 && (
          // Partial is allowed on purpose — an operator who can place
          // three of four items should not have to hold all four.
          <span className="wh-faint">The rest stay in hold until they have a shelf.</span>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Shelve these returns?"
        entity={ready
          .map((r) => `${r.skuCode} → ${binCode(choices[r.shipmentItemId] ?? '')}`)
          .join(', ')}
        entityIsIdentifier
        consequence={`${ready.length} of ${rows.length} line(s) move out of the returns hold onto the chosen shelves and become sellable at once.`}
        confirmLabel="Shelve now"
        error={error}
        onConfirm={async () => {
          const ok = await onShelve();
          if (!ok) throw new Error('refused');
          setConfirmOpen(false);
        }}
      />
    </section>
  );
}
