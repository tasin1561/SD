'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { PackageX } from 'lucide-react';
import type { SellerFailedAttemptView } from '@skydrop/api-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import { AwbCopy } from '@skydrop/ui/app/awb-copy';
import { Money } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { ListRow, ListRows } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useLocale, useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import { dateLocaleTag, formatDateTime } from '@/i18n/format';
import { InfoLabel } from '@/components/easy/about';

/**
 * "Delivery attempt failed" — parcels the courier tried to hand over and
 * could not, still with the courier.
 *
 * One card per parcel, newest failure first, and the whole group is absent
 * when there are none. Every fact on a card is optional on the wire (the
 * courier's panel may not have been read yet): a fact we do not have is left
 * out, never guessed. The red chip appears only when the courier's remark was
 * checked and did NOT hold up; "not checked yet" says nothing.
 */
export function FailedAttemptsSection({
  rows,
  now = Date.now(),
}: {
  readonly rows: readonly SellerFailedAttemptView[];
  /** Injected by tests so "2 hours ago" is a fixed string. */
  readonly now?: number;
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  if (rows.length === 0) return null;
  const sorted = newestFirst(rows);
  return (
    <section className="nat-section">
      <SectionHeading
        title={
          <InfoLabel
            label={t('needsAttention.failedTitle')}
            info={t('needsAttention.failedInfo')}
          />
        }
      />
      <ListRows label={t('needsAttention.failedTitle')}>
        {sorted.map((r) => (
          <ListRow
            key={r.orderId}
            href={`/orders/${r.orderId}`}
            Link={Link}
            severity={r.remarkVerified === false ? 'critical' : 'high'}
            icon={<PackageX size={16} />}
            title={<span className="sk-ident">{r.orderNumber}</span>}
            description={
              <>
                <span className="nat-line">
                  {r.recipientName}
                  <span className="nat-faint sk-ident"> · {r.recipientPhoneE164}</span>
                </span>
                {r.awbNumber !== null && (
                  <span className="nat-line nat-faint">
                    <AwbCopy awb={r.awbNumber} />
                    {r.courierCode !== null && <> · {r.courierCode}</>}
                  </span>
                )}
                <span className="nat-line nat-attempt">
                  <span>{t('needsAttention.failedAttempt', { n: r.attemptCount })}</span>
                  {r.lastRemark !== null && r.lastRemark !== '' && (
                    <span className="nat-attempt__part">{r.lastRemark}</span>
                  )}
                  {r.failedAt !== null && (
                    <time
                      className="nat-attempt__part"
                      dateTime={r.failedAt}
                      title={formatDateTime(r.failedAt, locale)}
                    >
                      {relativeTime(r.failedAt, now, locale)}
                    </time>
                  )}
                </span>
                {(r.deadlineDays !== null ||
                  (r.attemptsFailed !== null && r.attemptsMax !== null)) && (
                  <span className="nat-line nat-attempt nat-faint">
                    {r.deadlineDays !== null && (
                      <span>
                        {r.deadlineDays === 0
                          ? t('needsAttention.failedDeadlineToday')
                          : r.deadlineDays === 1
                            ? t('needsAttention.failedDeadlineOne')
                            : t('needsAttention.failedDeadline', { n: r.deadlineDays })}
                      </span>
                    )}
                    {r.attemptsFailed !== null && r.attemptsMax !== null && (
                      <span className={r.deadlineDays !== null ? 'nat-attempt__part' : undefined}>
                        {t('needsAttention.failedOfMax', {
                          a: r.attemptsFailed,
                          m: r.attemptsMax,
                        })}
                      </span>
                    )}
                  </span>
                )}
              </>
            }
            status={
              r.remarkVerified === false ? (
                <StatusChip
                  size="sm"
                  kind="failed"
                  label={t('needsAttention.failedRemarkNotVerified')}
                />
              ) : undefined
            }
            meta={
              r.codAmountInr !== null ? (
                <span className="nat-cod">
                  {richMessage(t('needsAttention.cod'), {
                    money: <Money amount={r.codAmountInr} currency="INR" convert={false} />,
                  })}
                </span>
              ) : undefined
            }
          />
        ))}
      </ListRows>
    </section>
  );
}

/** Newest failure first; a parcel with no scan time goes last, in the order it came. */
export function newestFirst(
  rows: readonly SellerFailedAttemptView[],
): readonly SellerFailedAttemptView[] {
  return [...rows].sort((a, b) => stamp(b.failedAt) - stamp(a.failedAt));
}

function stamp(iso: string | null): number {
  if (iso === null) return Number.NEGATIVE_INFINITY;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
}

/** "2 hours ago" / "2 ঘণ্টা আগে", with 0-9 digits in both languages. */
export function relativeTime(iso: string, now: number, locale: Locale): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const rtf = new Intl.RelativeTimeFormat(dateLocaleTag(locale), { numeric: 'auto' });
  // A scan stamped a little ahead of this device's clock is "now", never "in 5 minutes".
  const minutes = Math.min(0, Math.round((then - now) / 60_000));
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
