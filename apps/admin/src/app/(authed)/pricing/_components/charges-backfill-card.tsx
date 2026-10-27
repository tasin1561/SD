'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useBackfillCharges,
  useBillUnbilled,
  type ChargesBackfillReport,
  type BillingBackfillReport,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { MoSection } from '../../treasury/_components/money-parts';
import './pricing.css';
import { useT } from '@/i18n/client';

/** Where the REAL (not dry) run stands, for the parachute. Null until one starts. */
interface RealRun {
  readonly state: ParachuteState;
  readonly detail?: string | undefined;
}

/** A figure inside a toast, which is a string — the same en-IN grouping `Money` uses. */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/**
 * Give charges to orders that never got any.
 *
 * ── WHY THIS SCREEN EXISTS ───────────────────────────────────────────
 * `OrderService.create` computes charges post-commit, which covers
 * orders born through the app. Anything inserted another way arrives
 * with none — and an order with no charge rows is billed NOTHING when
 * it delivers, silently, because a zero sum reads as "nothing to
 * charge". This is how those orders are found and corrected.
 *
 * DRY RUN FIRST, and it is the default on both sides. The operator sees
 * exactly which orders would change before anything is written, because
 * "run it and see" is a bad way to touch money.
 *
 * It writes charge ROWS only — never a wallet entry. An order already
 * delivered stays unbilled until somebody decides to bill it; that is a
 * separate call about real money against a real seller.
 */
export function ChargesBackfillCard(): ReactElement | null {
  const t = useT();
  const canRun = usePermission('orders.charges.compute');
  const backfill = useBackfillCharges();
  const toast = useToast();
  const [report, setReport] = useState<ChargesBackfillReport | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [realRun, setRealRun] = useState<RealRun | null>(null);

  // Cosmetic only — the server is the boundary (FE-2). Hiding a control
  // nobody may use is UX, not security.
  if (!canRun) return null;

  /** The dry run, as a promise the Preview button's busy state follows. */
  async function preview(): Promise<void> {
    try {
      const r = await backfill.mutateAsync({ dryRun: true });
      setReport(r);
      setWasDryRun(true);
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  /** The real run — same request as before, now behind the confirm. */
  function runReal(): void {
    setConfirming(false);
    setRealRun({ state: 'running' });
    backfill.mutate(
      { dryRun: false },
      {
        onSuccess: (r) => {
          setReport(r);
          setWasDryRun(false);
          setRealRun({ state: 'done' });
          toast.success(
            t('pricingChargesBackfillCard.chargesAddedToOrderS', { value: String(r.persisted) }),
          );
        },
        onError: (err) => {
          setRealRun({ state: 'failed', detail: serverVerdict(err) });
          toast.error(serverVerdict(err));
        },
      },
    );
  }

  const examined = report?.examined ?? 0;

  return (
    <MoSection title={t('pricingChargesBackfillCard.ordersWithNoCharges')}>
      <p className="mo-p">{t('pricingChargesBackfillCard.anOrderWithNoCharge')}</p>

      <div className="mo-row">
        <AsyncButton
          variant="secondary"
          labels={{
            idle: t('pricingChargesBackfillCard.preview'),
            busy: t('pricingChargesBackfillCard.checking'),
            done: t('pricingChargesBackfillCard.previewReady'),
          }}
          onAction={preview}
          disabled={backfill.isPending}
        />
        <Button
          variant="primary"
          onClick={() => setConfirming(true)}
          disabled={backfill.isPending || report === null || !wasDryRun}
        >
          {t('pricingChargesBackfillCard.addTheMissingCharges')}
        </Button>
      </div>
      {report === null && (
        <p className="mo-faint">{t('pricingChargesBackfillCard.previewFirstThenTheSecond')}</p>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('pricingChargesBackfillCard.addChargesToOrder', {
          value: String(examined),
          value2: examined === 1 ? '' : t('common.pluralS'),
        })}
        entity={t('pricingChargesBackfillCard.orderFoundByThePreview', {
          value: String(examined),
          value2: examined === 1 ? '' : t('common.pluralS'),
        })}
        consequence={t('pricingChargesBackfillCard.writesChargeLinesOntoOrder', {
          value: String(examined),
          value2: examined === 1 ? '' : t('common.pluralS'),
        })}
        confirmLabel={t('pricingChargesBackfillCard.addTheMissingCharges')}
        onConfirm={runReal}
      />

      {realRun !== null && (
        <ParachuteProgress
          label={t('pricingChargesBackfillCard.addingTheMissingCharges')}
          state={realRun.state}
          detail={realRun.detail}
        />
      )}

      {backfill.isError && <ErrorState message={serverVerdict(backfill.error)} />}

      {report !== null && (
        <div className="mo-stack mo-stack--tight">
          <p className="pr-summary">
            {wasDryRun
              ? t('pricingChargesBackfillCard.wouldPrice')
              : t('pricingChargesBackfillCard.priced')}{' '}
            <span className="mo-strong sk-figure">{report.examined}</span> order
            {report.examined === 1 ? '' : 's'}
            {!wasDryRun && (
              <>
                {' '}
                {t('pricingChargesBackfillCard.addedAlreadyHadThemFailed', {
                  persisted: report.persisted,
                  skipped: report.skipped,
                  failed: report.failed,
                })}
              </>
            )}
            .
          </p>
          {report.orders.length > 0 && (
            <ul className="pr-orders">
              {report.orders.map((o) => (
                <li key={o.orderNumber}>
                  <span className="sk-ident">{o.orderNumber}</span>
                  <span className="mo-faint">{o.status}</span>
                  <span className="pr-orders__outcome">{o.outcome}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </MoSection>
  );
}

/**
 * Charge the orders that finished unbilled.
 *
 * ── WHY THIS IS A SECOND CARD AND NOT A THIRD BUTTON ─────────────────
 * The card above writes charge ROWS — it records what an order cost.
 * This takes the money out of a seller's balance. They are one keystroke
 * apart and a world apart in consequence, so they do not share a
 * surface: nobody correcting missing data should be able to debit
 * fifteen sellers by clicking one button along.
 *
 * Preview is mandatory, and the confirm names the amount and the count,
 * because "£X across N sellers" is the sentence somebody should have to
 * read before agreeing to it.
 */
export function BillUnbilledCard(): ReactElement | null {
  const t = useT();
  const canBill = usePermission('money.wallets.bill_unbilled');
  const bill = useBillUnbilled();
  const toast = useToast();
  const [report, setReport] = useState<BillingBackfillReport | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [realRun, setRealRun] = useState<RealRun | null>(null);

  if (!canBill) return null;

  /** The dry run, as a promise the Preview button's busy state follows. */
  async function preview(): Promise<void> {
    setConfirming(false);
    try {
      const r = await bill.mutateAsync({ dryRun: true });
      setReport(r);
      setPreviewed(true);
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  /** The real debit — same request as before, fired from the confirm. */
  function runReal(): void {
    setConfirming(false);
    setRealRun({ state: 'running' });
    bill.mutate(
      { dryRun: false },
      {
        onSuccess: (r) => {
          setReport(r);
          setPreviewed(false);
          setRealRun({ state: 'done' });
          toast.success(
            t('pricingChargesBackfillCard.billedOrderS', {
              value: String(r.billed),
              value2: inr.format(Number(r.totalInr)),
            }),
          );
        },
        onError: (err) => {
          setRealRun({ state: 'failed', detail: serverVerdict(err) });
          toast.error(serverVerdict(err));
        },
      },
    );
  }

  return (
    <MoSection title={t('pricingChargesBackfillCard.ordersThatFinishedUnbilled')} tone="critical">
      <p className="mo-p">{t('pricingChargesBackfillCard.deliveredOrReturnedOrdersWhose')}</p>

      <div className="mo-row">
        <AsyncButton
          variant="secondary"
          labels={{
            idle: t('pricingChargesBackfillCard.preview'),
            busy: t('pricingChargesBackfillCard.checking'),
            done: t('pricingChargesBackfillCard.previewReady'),
          }}
          onAction={preview}
          disabled={bill.isPending}
        />
        <Button
          variant="destructive"
          // The last thing between an operator and other people's money:
          // a confirm that names the count and the total the preview found.
          onClick={() => setConfirming(true)}
          disabled={bill.isPending || report === null || !previewed || report.examined === 0}
        >
          {t('pricingChargesBackfillCard.chargeThem')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('pricingChargesBackfillCard.chargeOrder', {
          value: String(report?.examined ?? 0),
          value2: report?.examined === 1 ? '' : t('common.pluralS'),
        })}
        entity={t('pricingChargesBackfillCard.orderFoundByThePreview', {
          value: String(report?.examined ?? 0),
          value2: report?.examined === 1 ? '' : t('common.pluralS'),
        })}
        amount={<Money amount={report?.totalInr ?? '0'} convert={false} />}
        consequence={t('pricingChargesBackfillCard.thisDebitsRealClientBalances')}
        confirmLabel={t('pricingChargesBackfillCard.chargeThem')}
        destructive
        onConfirm={runReal}
      >
        <p className="mo-p">
          The preview found <span className="mo-strong">{report?.examined ?? 0}</span> order
          {report?.examined === 1 ? '' : 's'} to bill, totalling{' '}
          <Money amount={report?.totalInr ?? '0'} convert={false} />.
        </p>
      </ConfirmDialog>

      {realRun !== null && (
        <ParachuteProgress
          label={t('pricingChargesBackfillCard.chargingTheUnbilledOrders')}
          state={realRun.state}
          detail={realRun.detail}
        />
      )}

      {bill.isError && <ErrorState message={serverVerdict(bill.error)} />}

      {report !== null && (
        <div className="mo-stack mo-stack--tight">
          <p className="pr-summary">
            {previewed
              ? t('pricingChargesBackfillCard.wouldCharge')
              : t('pricingChargesBackfillCard.charged')}{' '}
            <span className="mo-strong sk-figure">{report.examined}</span> order
            {report.examined === 1 ? '' : 's'}
            {!previewed && (
              <>
                {' '}
                — {report.billed} billed (<Money amount={report.totalInr} convert={false} />
                ), {report.skipped} had nothing to bill, {report.failed} failed
              </>
            )}
            .
          </p>
          {report.orders.length > 0 && (
            <ul className="pr-orders">
              {report.orders.map((o) => (
                <li key={o.orderNumber}>
                  <span className="sk-ident">{o.orderNumber}</span>
                  <span className="mo-faint">{o.status}</span>
                  <span className="pr-orders__outcome">{o.outcome}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </MoSection>
  );
}
