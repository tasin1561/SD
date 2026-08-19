'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Card, CardBody, Select, useToast } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { NON_PICKABLE_BIN_TYPES as NON_PICKABLE } from '@/lib/bin-policy';
import {
  useRtoPutaway,
  useRtoPutawayPending,
  useWarehouseBins,
  type RtoPutawayPending,
} from '@/lib/api-hooks';

/**
 * Shelving returned goods — the step that makes them sellable again.
 *
 * ── WHY THIS SCREEN EXISTS ───────────────────────────────────────────
 * Finalising a return does NOT put stock back on the shelf. Restocked
 * items land in an RTO_HOLD bin, because at that moment the carton is
 * on the returns bench and booking it onto a shelf nobody walked to
 * would be claiming a putaway that never happened. Availability
 * deliberately ignores hold bins (INV-3), so until somebody physically
 * shelves these and says where, the goods are counted as on-hand and
 * cannot be sold by anyone.
 *
 * Without this panel that was a dead end: the endpoint existed, no page
 * called it, and every good return quietly became unsellable stock.
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

  async function onShelve(): Promise<void> {
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
    } catch (err) {
      // FE-2: the server's refusal, verbatim. It knows things this
      // screen does not — a bin deleted since the list was fetched, a
      // line already shelved by somebody else.
      setError(serverVerdict(err));
    }
  }

  return (
    <Card className="mb-4">
      <CardBody>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-text-bright text-sm font-medium">
            In hold — not yet sellable ({rows.length})
          </h2>
          <span className="text-text-faint text-xs">
            These came back good. They stay unsellable until they are on a shelf.
          </span>
        </div>

        {error !== null && (
          <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical mb-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {bins.isError && (
          <div className="text-critical mb-3 text-sm">
            Could not load bins for this warehouse — {bins.error?.message ?? 'unknown error'}.
          </div>
        )}

        <div className="space-y-2">
          {rows.map((r) => {
            const chosen = choices[r.shipmentItemId] ?? '';
            const isSuggestion = chosen !== '' && chosen === r.suggestedBinId;
            return (
              <div
                key={r.shipmentItemId}
                className="border-border grid grid-cols-1 items-center gap-2 rounded-md border p-2.5 sm:grid-cols-[1fr_auto_minmax(200px,260px)]"
              >
                <div className="min-w-0">
                  <div className="text-text-bright truncate text-sm">{r.productName}</div>
                  <div className="text-text-faint mt-0.5 font-mono text-xs">
                    {r.skuCode} · {r.quantity} unit{r.quantity === 1 ? '' : 's'} · in{' '}
                    {r.holdBinCode}
                  </div>
                </div>

                <div className="text-text-faint text-xs">
                  {r.suggestedBinCode !== null && r.suggestionReason !== null ? (
                    <span>
                      suggested{' '}
                      <span className="text-text-body font-mono">{r.suggestedBinCode}</span>{' '}
                      <span className="opacity-70">
                        ({REASON_LABEL[r.suggestionReason] ?? r.suggestionReason})
                      </span>
                    </span>
                  ) : (
                    // Said out loud rather than shown as an empty dropdown:
                    // this SKU has never been here before.
                    <span className="opacity-70">no suggestion — pick a shelf</span>
                  )}
                </div>

                <Select
                  aria-label={`Shelf for ${r.skuCode}`}
                  value={chosen}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setChoices((prev) => ({ ...prev, [r.shipmentItemId]: e.target.value }))
                  }
                  className={isSuggestion ? '' : 'border-border-strong'}
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
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            disabled={putaway.isPending || ready.length === 0}
            onClick={() => void onShelve()}
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
            <span className="text-text-faint text-xs">
              The rest stay in hold until they have a shelf.
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
