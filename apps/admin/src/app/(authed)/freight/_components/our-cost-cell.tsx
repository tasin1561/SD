'use client';

import { useState, type ReactElement } from 'react';
import { Button, Input, Modal, ModalFooter, Money } from '@skydrop/ui/components';
import { useSetFreightOurCost, type FreightChargeView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * What the FORWARDER charged us, against what we billed the seller.
 *
 * Editable at any point in the bill's life, including after settlement:
 * their invoice routinely arrives weeks after the goods, and what the
 * seller paid is an independent fact from what we paid. Blocking the
 * entry until some earlier step would only produce a guess, and a guessed
 * cost is worse than a missing one — the P&L can say "not measured", it
 * cannot say "measured, but made up".
 */
export function OurCostCell({ row }: { readonly row: FreightChargeView }): ReactElement {
  // Read here rather than threaded down: the gate is cosmetic (FE-2 —
  // the server is the boundary), and a prop through every row exists
  // only to be forgotten on the next one added.
  const canWrite = usePermission('money.freight.manage');
  const set = useSetFreightOurCost();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(row.ourCostInr ?? '');
  const [error, setError] = useState<string | null>(null);

  const margin = row.ourCostInr === null ? null : Number(row.totalInr) - Number(row.ourCostInr);

  async function save(): Promise<void> {
    setError(null);
    if (value.trim() === '' || Number.isNaN(Number(value))) {
      setError('Enter what the forwarder charged, in INR');
      return;
    }
    try {
      await set.mutateAsync({ freightChargeId: row.id, ourCostInr: Number(value).toFixed(2) });
      setOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <>
      {row.ourCostInr === null ? (
        canWrite ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Record cost
          </Button>
        ) : (
          <span className="text-text-faint">—</span>
        )
      ) : (
        <button
          type="button"
          className="text-right disabled:cursor-default"
          onClick={() => canWrite && setOpen(true)}
          disabled={!canWrite}
        >
          <Money amount={row.ourCostInr} />
          {margin !== null && (
            <div
              className={`text-xs ${margin < 0 ? 'text-danger' : 'text-text-muted'}`}
              title="What we billed the seller, less what the forwarder charged us"
            >
              {margin < 0 ? '' : '+'}
              {margin.toFixed(2)} margin
            </div>
          )}
        </button>
      )}

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="What did the forwarder charge us?"
        description="This is our cost for the BD→India leg. It does not change what the seller was billed."
      >
        <Input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 8500.00"
          autoFocus
        />
        <p className="text-text-muted mt-2 text-xs">
          Billed to the seller: <Money amount={row.totalInr} />
        </p>
        {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={set.isPending}>
            {set.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
