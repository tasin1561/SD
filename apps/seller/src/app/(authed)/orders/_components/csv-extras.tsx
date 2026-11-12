'use client';

import type { ReactElement } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { OrderCsvExtras } from '@skydrop/api-client';
import { useT } from '@/i18n/client';
import { DetailCard } from './detail/detail-card';
import './orders.css';

/**
 * The spreadsheet columns the importer did NOT use, read back to the seller.
 *
 * The one thing this must never do is look like we honoured them. Every
 * value is labelled "Not used" with the importer's own reason, or "Not
 * understood" when the column is unknown to us. Collapsed by default,
 * read-only, and it links to nothing: reference material, not part of the
 * order. An order placed through the form has no extras, so it renders
 * nothing at all.
 */
export function CsvExtrasSection({
  extras,
}: {
  readonly extras: OrderCsvExtras | null | undefined;
}): ReactElement | null {
  const t = useT();
  if (!extras || extras.rows.length === 0) return null;

  const total = extras.rows.reduce((n, r) => n + r.unused.length + r.unrecognised.length, 0);
  const multi = extras.rows.length > 1;

  return (
    <DetailCard
      id="csv-extras"
      icon={<FileSpreadsheet size={18} />}
      title={t('orderDetail.extrasTitle')}
      titleText={t('orderDetail.extrasTitle')}
      note={t('orderPage.card.extrasNote')}
      defaultOpen={false}
    >
      <p className="ord-faint">{t('orderDetail.extrasShow', { count: String(total) })}</p>
      <div className="ord-extras__inner">
        <p className="ord-extras__warning" role="note">
          {t('orderDetail.extrasWarning')}
        </p>
        {extras.rows.map((r) => (
          <div key={r.row} className="ord-extras__row">
            {multi && (
              <p className="ord-extras__rowtitle">
                {t('orderDetail.extrasRow', { row: String(r.row) })}
              </p>
            )}
            <dl className="ord-extras__list">
              {r.unused.map((c) => (
                <div key={`u-${c.header}`} className="ord-extras__item">
                  <dt className="ord-extras__header">{c.header}</dt>
                  <dd className="ord-extras__value">
                    <span className="ord-extras__val">{c.value}</span>
                    <span className="ord-extras__chips">
                      <span className="ord-extras__chip">{t('orderDetail.extrasNotUsed')}</span>
                      {c.truncated === true && (
                        <span className="ord-extras__chip">{t('orderDetail.extrasTruncated')}</span>
                      )}
                    </span>
                    <span className="ord-faint ord-extras__why">
                      {t('orderDetail.extrasWhy', { reason: c.reason })}
                    </span>
                  </dd>
                </div>
              ))}
              {r.unrecognised.map((c) => (
                <div key={`n-${c.header}`} className="ord-extras__item">
                  <dt className="ord-extras__header">{c.header}</dt>
                  <dd className="ord-extras__value">
                    <span className="ord-extras__val">{c.value}</span>
                    <span className="ord-extras__chips">
                      <span className="ord-extras__chip" data-kind="unknown">
                        {t('orderDetail.extrasNotUnderstood')}
                      </span>
                      {c.truncated === true && (
                        <span className="ord-extras__chip">{t('orderDetail.extrasTruncated')}</span>
                      )}
                    </span>
                    <span className="ord-faint ord-extras__why">
                      {t('orderDetail.extrasNotUnderstoodHint')}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {extras.omitted !== undefined && extras.omitted > 0 && (
          <p className="ord-faint">
            {t('orderDetail.extrasOmitted', { count: String(extras.omitted) })}
          </p>
        )}
      </div>
    </DetailCard>
  );
}
