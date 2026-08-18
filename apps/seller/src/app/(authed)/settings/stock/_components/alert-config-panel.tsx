'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  Skeleton,
  useToast,
} from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useSetDefaultStockThreshold, useStockAlertConfig } from '@/lib/api-hooks';

/** Mirrors @Min(0)/@Max(1_000_000) on SetDefaultThresholdDto. Mirrored only
 *  so the operator is told before submitting; the server still decides. */
const MAX_THRESHOLD = 1_000_000;

/**
 * The seller's default low-stock threshold.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Low-stock alerting has worked server-side since M5, but nothing could
 * configure it. `StockAlertService` resolves
 * `variant.lowStockThreshold ?? seller.defaultLowStockThreshold ?? null`
 * and returns SKIPPED_NO_THRESHOLD when that lands on null — so a seller
 * who was never seeded a default gets NO low-stock alert on any SKU,
 * silently, and had no screen to fix it. This is that screen.
 *
 * ── EMPTY IS A REAL SETTING, NOT A MISSING ONE ───────────────────────
 * The DTO takes `number | null` and `null` explicitly CLEARS the
 * default. So the field being blank must submit `null`, not omit the
 * key: `@IsDefined` under `@ValidateIf` rejects `undefined` while
 * allowing `null`, and the API runs forbidNonWhitelisted — an omitted
 * key is a 400, not a no-op. The copy says out loud what clearing does,
 * because "0" and "off" are not the same thing here: 0 alerts only at
 * genuinely empty, null never alerts at all.
 *
 * Per-SKU overrides beat this number and are set on the variant page;
 * this is the floor for everything that has no opinion of its own.
 */
export function AlertConfigPanel(): ReactElement | null {
  const identity = useSellerIdentity();
  const toast = useToast();
  const config = useStockAlertConfig();
  const save = useSetDefaultStockThreshold();

  // `null` means "showing whatever the server last told us" — typing
  // takes over, saving hands control back so the panel re-reads the
  // value the server actually stored rather than the one we sent.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cosmetic (FE-2). The page opens on inventory.view; changing the
  // threshold is PATCH /seller/stock/alert-config/default, which the
  // server guards with 'catalog.manage'. Rendering an editor somebody
  // may not use just moves the refusal to after they have typed.
  if (!can(identity, 'catalog.manage')) return null;

  const serverValue =
    config.data === undefined
      ? ''
      : config.data.defaultLowStockThreshold === null
        ? ''
        : String(config.data.defaultLowStockThreshold);
  const value = draft ?? serverValue;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  const clearing = trimmed === '';
  const valid = clearing || (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_THRESHOLD);
  const dirty = trimmed !== serverValue.trim();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    try {
      await save.mutateAsync({ defaultLowStockThreshold: clearing ? null : parsed });
      setDraft(null);
      toast.success(
        clearing
          ? 'Default threshold cleared — SKUs without their own will not alert.'
          : 'Default low-stock threshold saved.',
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Low-stock alerts"
        subtitle="Warn me when a SKU's available quantity falls below this."
      />
      <CardBody>
        {config.isLoading ? (
          <Skeleton className="h-9 w-56" />
        ) : config.isError ? (
          <ErrorNote
            message={serverVerdict(config.error, 'Could not load your alert settings.')}
            retry={() => void config.refetch()}
          />
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            {error !== null && <ErrorNote message={error} />}
            <div className="flex flex-wrap items-end gap-3">
              <FormField
                label="Default threshold"
                htmlFor="default-low-stock-threshold"
                hint={
                  clearing
                    ? 'Empty — no SKU alerts unless it carries its own threshold.'
                    : `Units. Whole number, 0–${MAX_THRESHOLD.toLocaleString('en-IN')}.`
                }
                error={
                  valid
                    ? undefined
                    : `Enter a whole number between 0 and ${MAX_THRESHOLD.toLocaleString('en-IN')}, or leave empty to turn alerts off.`
                }
                className="w-40"
              >
                <Input
                  id="default-low-stock-threshold"
                  inputMode="numeric"
                  value={value}
                  placeholder="Off"
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={save.isPending}
                />
              </FormField>
              <div className="flex items-center gap-2 pb-1">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={!valid || !dirty || save.isPending}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
                {dirty && !save.isPending && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setDraft(null);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            <p className="text-text-muted text-xs">
              A SKU with its own threshold ignores this one — set that on the variant page. Leaving
              this empty turns alerts off for everything else; zero still alerts, but only once the
              SKU is completely out.
            </p>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
