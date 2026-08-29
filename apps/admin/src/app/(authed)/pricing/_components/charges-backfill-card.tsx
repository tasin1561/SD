'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody, CardHeader, ErrorNote, useToast } from '@skydrop/ui/components';
import {
  useBackfillCharges,
  useBillUnbilled,
  type ChargesBackfillReport,
  type BillingBackfillReport,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

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
  const canRun = usePermission('orders.charges.compute');
  const backfill = useBackfillCharges();
  const toast = useToast();
  const [report, setReport] = useState<ChargesBackfillReport | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);

  // Cosmetic only — the server is the boundary (FE-2). Hiding a control
  // nobody may use is UX, not security.
  if (!canRun) return null;

  function run(dryRun: boolean): void {
    backfill.mutate(
      { dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          setWasDryRun(dryRun);
          if (!dryRun) toast.success(`Charges added to ${String(r.persisted)} order(s).`);
        },
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Card>
      <CardHeader title="Orders with no charges" />
      <CardBody>
        <p className="text-text-muted mb-3 text-xs leading-relaxed">
          An order with no charge rows is billed nothing when it delivers — the sum is zero, so
          there is nothing to take, and no error says so. This finds those orders and prices them at
          the current flat fee. It writes the charge lines only; nothing is taken from a
          seller&rsquo;s wallet here.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run(true)} disabled={backfill.isPending}>
            {backfill.isPending ? 'Checking…' : 'Preview'}
          </Button>
          <Button
            variant="primary"
            onClick={() => run(false)}
            disabled={backfill.isPending || report === null || !wasDryRun}
          >
            Add the missing charges
          </Button>
        </div>
        {report === null && (
          <p className="text-text-faint mt-2 text-xs">Preview first — then the second button.</p>
        )}

        {backfill.isError && (
          <div className="mt-3">
            <ErrorNote message={serverVerdict(backfill.error)} />
          </div>
        )}

        {report !== null && (
          <div className="mt-3">
            <p className="text-sm">
              {wasDryRun ? 'Would price' : 'Priced'}{' '}
              <span className="font-medium">{report.examined}</span> order
              {report.examined === 1 ? '' : 's'}
              {!wasDryRun && (
                <>
                  {' '}
                  — {report.persisted} added, {report.skipped} already had them, {report.failed}{' '}
                  failed
                </>
              )}
              .
            </p>
            {report.orders.length > 0 && (
              <ul className="border-border mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {report.orders.map((o) => (
                  <li key={o.orderNumber} className="flex flex-wrap gap-x-2 text-xs">
                    <span className="font-mono">{o.orderNumber}</span>
                    <span className="text-text-faint">{o.status}</span>
                    <span className="text-text-muted ml-auto">{o.outcome}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
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
  const canBill = usePermission('money.wallets.bill_unbilled');
  const bill = useBillUnbilled();
  const toast = useToast();
  const [report, setReport] = useState<BillingBackfillReport | null>(null);
  const [previewed, setPreviewed] = useState(false);

  if (!canBill) return null;

  function run(dryRun: boolean): void {
    if (!dryRun) {
      const n = report?.examined ?? 0;
      // The last thing between an operator and other people's money.
      if (!window.confirm(`Charge ${String(n)} order(s)? This debits real seller balances.`))
        return;
    }
    bill.mutate(
      { dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          setPreviewed(dryRun);
          if (!dryRun) toast.success(`Billed ${String(r.billed)} order(s) — ₹${r.totalInr}.`);
        },
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Card tone="critical">
      <CardHeader title="Orders that finished unbilled" />
      <CardBody>
        <p className="text-text-muted mb-3 text-xs leading-relaxed">
          Delivered or returned orders whose carriage was never taken. This is a real debit against
          a real seller balance — not a correction to a record. Only orders whose journey has ended
          are eligible; an in-transit one is billed when it lands.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run(true)} disabled={bill.isPending}>
            {bill.isPending ? 'Checking…' : 'Preview'}
          </Button>
          <Button
            variant="destructive"
            onClick={() => run(false)}
            disabled={bill.isPending || report === null || !previewed || report.examined === 0}
          >
            Charge them
          </Button>
        </div>

        {bill.isError && (
          <div className="mt-3">
            <ErrorNote message={serverVerdict(bill.error)} />
          </div>
        )}

        {report !== null && (
          <div className="mt-3">
            <p className="text-sm">
              {previewed ? 'Would charge' : 'Charged'}{' '}
              <span className="font-medium">{report.examined}</span> order
              {report.examined === 1 ? '' : 's'}
              {!previewed && (
                <>
                  {' '}
                  — {report.billed} billed (₹{report.totalInr}), {report.skipped} had nothing to
                  bill, {report.failed} failed
                </>
              )}
              .
            </p>
            {report.orders.length > 0 && (
              <ul className="border-border mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {report.orders.map((o) => (
                  <li key={o.orderNumber} className="flex flex-wrap gap-x-2 text-xs">
                    <span className="font-mono">{o.orderNumber}</span>
                    <span className="text-text-faint">{o.status}</span>
                    <span className="text-text-muted ml-auto">{o.outcome}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
