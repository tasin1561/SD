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
  useToast,
} from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useSetVariantInventoryMode,
  useSetVariantThreshold,
  useVariantInventoryMode,
  useVariantStock,
  type SellerInventoryMode,
} from '@/lib/api-hooks';

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
 * ── THREE STATES, NOT TWO ────────────────────────────────────────────
 * `null` is not a synonym for NORMAL. It clears the SKU's own value so
 * it follows the seller default, and a seller who moves their catalogue
 * to STRICT has to be able to put one SKU back on "whatever the
 * catalogue does" rather than pinning it to NORMAL forever. So the
 * control offers Inherit / Normal / Strict, and says which one is
 * actually in force when the answer is inherited.
 *
 * The key is always PRESENT on the wire either way — the DTO's
 * `@IsDefined` under `@ValidateIf` accepts null and rejects undefined,
 * so an omitted key is a 400 rather than a no-op.
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
  const setMode = useSetVariantInventoryMode(productId, variantId);
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

  async function onModeChange(next: string): Promise<void> {
    setError(null);
    try {
      // '' is the Inherit option and travels as an explicit null.
      const value: SellerInventoryMode | null = next === '' ? null : (next as SellerInventoryMode);
      const result = await setMode.mutateAsync({ inventoryMode: value });
      toast.success(
        value === null
          ? `Following the catalogue default — ${result.effectiveInventoryMode.toLowerCase()} for now.`
          : value === 'STRICT'
            ? 'Strict — every unit of this SKU now needs a serial scanned at receiving, pick and pack.'
            : 'Normal — counted in bulk, no per-unit serials.',
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

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
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Unit tracking"
              hint={
                mode.data?.inherited === true
                  ? `Following your catalogue default, which is ${mode.data.effectiveInventoryMode.toLowerCase()} today.`
                  : 'Set on this SKU, whatever the catalogue default becomes.'
              }
            >
              <Select
                value={mode.data?.inventoryMode ?? ''}
                disabled={setMode.isPending}
                onChange={(e) => void onModeChange(e.target.value)}
              >
                <option value="">Use catalogue default</option>
                <option value="NORMAL">Normal — count in bulk</option>
                <option value="STRICT">Strict — a serial per unit</option>
              </Select>
            </FormField>

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
            Strict means the warehouse cannot receive, pick or pack a unit of this SKU without
            scanning its serial. Every unit needs one on the item itself before the next consignment
            arrives.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
