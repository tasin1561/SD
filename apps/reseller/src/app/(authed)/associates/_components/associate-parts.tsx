'use client';

import type { ReactElement, ReactNode } from 'react';
import { Switch } from '@skydrop/ui/app/switch';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { usePauseAssociateOrders, type AssociateSummary, type Rate } from '@/lib/associate-hooks';
import './associates.css';

/**
 * The associates area's presentational pieces. Nothing here decides a
 * permission (the pages are gated on `associates.manage`, which is also
 * what every endpoint behind them needs) and nothing here formats money
 * — every amount arrives as the caller's own `<Money>` node.
 */

/** A section: the caller's own `SectionHeading` and its body. */
export function AsSection({ children }: { readonly children: ReactNode }): ReactElement {
  return <section className="as-section">{children}</section>;
}

/**
 * A rate as a percentage, or a dash.
 *
 * Null is "nothing has had an outcome yet" and prints as a dash, never
 * as 0% — RS-9's rule is that an unknown rate says so rather than
 * reading as a perfect or a terrible one.
 */
export function pct(value: Rate): string {
  if (value === null) return '—';
  return Number.isFinite(value) ? `${value}%` : '—';
}

/** Name and email, as one cell. */
export function AssociatePerson({
  fullName,
  email,
}: {
  readonly fullName: string;
  readonly email?: string | undefined;
}): ReactElement {
  return (
    <div className="as-person">
      <span className="as-person__name">{fullName}</span>
      {email !== undefined && email !== '' ? (
        <span className="as-person__email">{email}</span>
      ) : null}
    </div>
  );
}

/**
 * How many products this person is priced for, and how many of those
 * prices the seller's range has moved out from under.
 *
 * On the LIST, not behind a click, because these two numbers are the
 * thing that silently stops somebody selling: a product with no price
 * is refused by name at the order, and so is one whose price now sits
 * outside the seller's terms.
 */
export function AssociateCoverage({
  priced,
  missing,
  sellable,
  outOfRange,
}: {
  readonly priced: number;
  readonly missing: number;
  readonly sellable: number;
  readonly outOfRange: number;
}): ReactElement {
  return (
    <div className="as-product">
      <span className="as-count sk-figure" data-tone={missing > 0 ? 'warn' : undefined}>
        {priced} of {sellable}
      </span>
      <span className="as-coverage">
        {sellable === 0
          ? // Your seller has turned nothing on for this store, so there is
            // nothing an associate could be priced for. Saying "priced for
            // everything" here would read as a clean bill of health.
            'Your seller sells nothing through this store yet'
          : missing === 0
            ? 'Priced for everything this store sells'
            : `${missing} product${missing === 1 ? '' : 's'} they cannot sell yet`}
      </span>
      {outOfRange > 0 ? (
        <span className="as-count" data-tone="bad">
          {outOfRange} price{outOfRange === 1 ? '' : 's'} outside the seller’s range
        </span>
      ) : null}
    </div>
  );
}

/**
 * Switch one associate's order CREATION on or off, where the thing that
 * makes you want to is.
 *
 * It sits on the list AND on every analysis row on purpose: the whole
 * point of the analysis screen is "decide what to do about this
 * person", and making somebody navigate away to act on what they have
 * just read is how a feature goes unused.
 *
 * The words say what it really does (ASSOC-1): orders already placed
 * carry on, and they keep reading, tracking, cancelling and chasing
 * them. A refusal is the server's own (FE-2).
 */
export function AssociatePauseSwitch({
  associate,
}: {
  readonly associate: Pick<AssociateSummary, 'storeUserId' | 'fullName' | 'ordersPausedAt'>;
}): ReactElement {
  const toast = useToast();
  const pause = usePauseAssociateOrders();
  const canPlace = associate.ordersPausedAt === null;
  return (
    <Switch
      checked={canPlace}
      disabled={pause.isPending}
      onText="On"
      offText="Off"
      label="Can place orders"
      description={
        canPlace
          ? 'Switch off and they place no new orders. Everything already placed carries on.'
          : 'They place no new orders. Orders already placed carry on, and they can still follow and chase them.'
      }
      onCheckedChange={(next) => {
        void (async () => {
          try {
            await pause.mutateAsync({ storeUserId: associate.storeUserId, paused: !next });
            toast.success(
              next
                ? `${associate.fullName} can place orders again.`
                : `${associate.fullName} places no new orders. Everything already placed carries on.`,
            );
          } catch (err) {
            toast.error(serverVerdict(err));
          }
        })();
      }}
    />
  );
}
