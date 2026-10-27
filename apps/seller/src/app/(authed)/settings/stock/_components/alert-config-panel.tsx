'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { BellRing, CircleAlert } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { TextField } from '@skydrop/ui/app/text-field';
import { AsyncButton, useAsyncState } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import { useSetDefaultStockThreshold, useStockAlertConfig } from '@/lib/api-hooks';
import { SetCallout, SetFact } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';

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
  const t = useT();
  const identity = useSellerIdentity();
  const toast = useToast();
  const config = useStockAlertConfig();
  const save = useSetDefaultStockThreshold();

  // `null` means "showing whatever the server last told us" — typing
  // takes over, saving hands control back so the panel re-reads the
  // value the server actually stored rather than the one we sent.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useAsyncState();

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

  async function doSave(): Promise<void> {
    setError(null);
    try {
      await save.mutateAsync({ defaultLowStockThreshold: clearing ? null : parsed });
      setDraft(null);
      toast.success(
        clearing
          ? t('settingsStock.defaultThresholdClearedSkus')
          : t('settingsStock.defaultLowStockThreshold'),
      );
    } catch (err) {
      setError(verdict(err, t));
      // Rethrown so the Save button shows the failure on itself.
      throw err;
    }
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!valid) return;
    void run.run(doSave);
  }

  return (
    <section className="set-section">
      <SectionHeading
        title={t('settingsStock.lowStockAlerts')}
        /*
          "Off" is a real setting here and it is the one worth saying in
          the heading: a blank field and a field still loading look the
          same, and only one of them means no SKU will ever alert.
        */
        note={
          config.data === undefined ? undefined : config.data.defaultLowStockThreshold === null ? (
            <SetFact tone="warn">{t('settingsStock.offNothingAlertsBy')}</SetFact>
          ) : (
            <SetFact tone="good" dot>
              {t('settingsStock.warningBelowUnits', {
                defaultLowStockThreshold:
                  config.data.defaultLowStockThreshold.toLocaleString('en-IN'),
              })}
            </SetFact>
          )
        }
      />
      <div className="set-card">
        {config.isLoading ? (
          <Skeleton width={224} height={40} />
        ) : config.isError ? (
          <ErrorState
            message={verdict(config.error, t, t('settingsStock.couldNotLoadYour'))}
            retry={() => void config.refetch()}
          />
        ) : (
          <form onSubmit={onSubmit} className="set-form-grid">
            {error !== null && (
              <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                <p>{error}</p>
              </SetCallout>
            )}
            <div className="set-inline">
              <TextField
                label={t('settingsStock.defaultThreshold')}
                id="default-low-stock-threshold"
                icon={<BellRing size={15} />}
                hint={
                  clearing
                    ? t('settingsStock.emptyNoSkuAlerts')
                    : t('settingsStock.unitsWholeNumber0', {
                        maxThreshold: MAX_THRESHOLD.toLocaleString('en-IN'),
                      })
                }
                error={
                  valid
                    ? undefined
                    : t('settingsStock.enterAWholeNumber', {
                        maxThreshold: MAX_THRESHOLD.toLocaleString('en-IN'),
                      })
                }
                inputMode="numeric"
                value={value}
                placeholder={t('settingsStock.off')}
                onChange={(e) => setDraft(e.target.value)}
                disabled={save.isPending}
                inputClassName="sk-figure"
                className="set-narrow"
              />
              <div className="set-buttons" data-align="start">
                <AsyncButton
                  type="submit"
                  variant="primary"
                  labels={{
                    idle: t('settingsStock.save'),
                    busy: t('settingsStock.saving'),
                    done: t('settingsStock.saved'),
                    error: t('settingsStock.notSaved'),
                  }}
                  state={run.phase}
                  disabled={!valid || !dirty || save.isPending}
                />
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
                    {t('settingsStock.cancel')}
                  </Button>
                )}
              </div>
            </div>
            <p className="set-muted">{t('settingsStock.aSkuWithIts')}</p>
          </form>
        )}
      </div>
    </section>
  );
}
