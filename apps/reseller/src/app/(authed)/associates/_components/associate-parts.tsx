'use client';

import type { ReactElement, ReactNode } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { Switch } from '@skydrop/ui/app/switch';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
  const t = useT();
  return (
    <div className="as-product">
      {/* The icon is not decoration: the chip's colour is the only other
          thing saying "some of these are missing", and colour alone is
          never a signal. It is aria-hidden because the sentence below
          says the same thing in words. */}
      <span className="as-count sk-figure" data-tone={missing > 0 ? 'warn' : undefined}>
        {missing > 0 ? <TriangleAlert size={12} className="as-count__icon" aria-hidden /> : null}
        {t('assoc.cov.priced', { priced, sellable })}
      </span>
      <span className="as-coverage">
        {sellable === 0
          ? // Your seller has turned nothing on for this store, so there is
            // nothing an associate could be priced for. Saying "priced for
            // everything" here would read as a clean bill of health.
            t('assoc.cov.nothing')
          : missing === 0
            ? t('assoc.cov.all')
            : t(missing === 1 ? 'assoc.cov.missing.one' : 'assoc.cov.missing.other', {
                n: missing,
              })}
      </span>
      {outOfRange > 0 ? (
        <span className="as-count" data-tone="bad">
          <CircleAlert size={12} className="as-count__icon" aria-hidden />
          {t(outOfRange === 1 ? 'assoc.cov.out.one' : 'assoc.cov.out.other', { n: outOfRange })}
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
  const t = useT();
  const toast = useToast();
  const pause = usePauseAssociateOrders();
  const canPlace = associate.ordersPausedAt === null;
  return (
    <Switch
      checked={canPlace}
      disabled={pause.isPending}
      onText={t('assoc.switch.on')}
      offText={t('assoc.switch.off')}
      label={t('assoc.switch.label')}
      description={canPlace ? t('assoc.switch.descOn') : t('assoc.switch.descOff')}
      onCheckedChange={(next) => {
        void (async () => {
          try {
            await pause.mutateAsync({ storeUserId: associate.storeUserId, paused: !next });
            toast.success(
              next
                ? t('assoc.switch.toastOn', { name: associate.fullName })
                : t('assoc.switch.toastOff', { name: associate.fullName }),
            );
          } catch (err) {
            toast.error(verdict(err, t));
          }
        })();
      }}
    />
  );
}
