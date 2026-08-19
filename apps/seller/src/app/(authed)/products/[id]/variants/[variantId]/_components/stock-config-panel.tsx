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
  useToast,
} from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useSetVariantThreshold, useVariantInventoryMode, useVariantStock } from '@/lib/api-hooks';

/**
 * The two per-SKU stock settings, on the SKU.
 *
 * Both endpoints shipped without a caller and the variant page had no
 * config controls at all, which left R4 half-built in a particularly
 * confusing way: pick, pack and receiving all enforce per-unit serials
 * for a STRICT SKU, the discrepancy screen says "only SKUs you have set
 * to strict per-unit tracking appear here" — and nothing in the product
 * could set one. The enforcement existed; the switch did not.
 *
 * ── UNIT TRACKING IS NOT THE SELLER'S TO SET (2026-08-19) ────────────
 * The mode decides whether our staff must scan a serial for every
 * physical unit at pick, pack and RTO. That is our operating procedure,
 * not a seller preference: a seller flipping it changes what the floor
 * must do with every parcel of theirs, and pins picks to refusal for
 * SKUs nobody serialised. It is shown here when it is on, so a seller
 * understands why their stock is handled that way, and set by an admin —
 * per seller from the seller's detail page, or globally in settings.
 *
 * What remains here is the LOW-STOCK THRESHOLD, which is genuinely
 * theirs: it decides when we warn them, and warns nobody else.
 */

export function StockConfigPanel({
  productId,
  variantId,
}: {
  readonly productId: string;
  readonly variantId: string;
}): ReactElement | null {
  const toast = useToast();
  const mayManage = can(useSellerIdentity(), 'catalog.manage');

  const mode = useVariantInventoryMode(productId, variantId);
  // The only read that carries this SKU's own threshold — the variant
  // projection does not, and a box you type into without seeing what is
  // already set is worse than no box.
  const stock = useVariantStock(variantId);
  const setThreshold = useSetVariantThreshold(productId, variantId);

  // `undefined` means "not seeded from the server yet"; once the seller
  // types, their input wins over any later refetch.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const threshold =
    typed ??
    (stock.data === undefined || stock.data.lowStockThreshold === null
      ? ''
      : String(stock.data.lowStockThreshold));
  const [error, setError] = useState<string | null>(null);

  if (!mayManage) return null;

  async function onSaveThreshold(): Promise<void> {
    setError(null);
    const trimmed = threshold.trim();
    const parsed = Number(trimmed);
    try {
      // Blank CLEARS it back to the seller default, which is a different
      // thing from a threshold of 0 — 0 means "warn me only at empty".
      const value = trimmed === '' ? null : parsed;
      await setThreshold.mutateAsync({ lowStockThreshold: value });
      setTyped(undefined);
      toast.success(
        value === null
          ? 'Cleared — this SKU uses your default low-stock level.'
          : `Low-stock alerts at ${value} units or fewer.`,
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const trimmed = threshold.trim();
  const parsed = Number(trimmed);
  const thresholdValid =
    trimmed === '' || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000);

  return (
    <Card className="mt-4">
      <CardHeader
        title="Stock handling"
        subtitle="How this SKU is counted on the warehouse floor, and when we warn you it is running out."
      />
      <CardBody>
        {error !== null && <ErrorNote message={error} />}

        {mode.isLoading ? (
          <SkeletonRows rows={2} />
        ) : mode.isError ? (
          <ErrorNote message={serverVerdict(mode.error)} retry={() => void mode.refetch()} />
        ) : (
          <div className="grid gap-4">
            <FormField
              label="Low-stock alert at"
              hint="Units. Leave blank to use your default; 0 warns only when it is empty."
              error={thresholdValid ? undefined : 'Whole number between 0 and 1,000,000.'}
            >
              <div className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  value={threshold}
                  onChange={(e) => setTyped(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!thresholdValid || setThreshold.isPending}
                  onClick={() => void onSaveThreshold()}
                >
                  {setThreshold.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </FormField>
          </div>
        )}

        {mode.data?.effectiveInventoryMode === 'STRICT' && (
          <p className="text-text-muted mt-3 text-sm">
            This SKU is on strict unit tracking: the warehouse cannot receive, pick or pack a unit
            without scanning its serial, so every unit needs one on the item itself before the next
            consignment arrives. We set this — talk to us if it looks wrong for this SKU.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
