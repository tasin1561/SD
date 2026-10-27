'use client';

import { useState, type ReactElement } from 'react';
import { Check, FileSignature, History, Quote, TriangleAlert } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useAcceptTerms, useStoreTerms, type StoreTermsView } from '@/lib/terms-hooks';
import { RmAlert, RmCallout, RmSection } from '../wallet/_components/rm-parts';

/**
 * RS-4 — the seller's terms for this store, in plain words: who pays which
 * Skydrop fee on your orders, when you and the seller are credited, and
 * the button that agrees to them on the store's behalf.
 */
export default function TermsPage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const terms = useStoreTerms();

  if (terms.isPending || terms.isError) {
    return (
      <div className="rm-page">
        <PageHeader title={t('terms.title')} subtitle={t('terms.subtitle.loading')} />
        {terms.isPending ? (
          <>
            <Skeleton className="rm-kpi-skel" height={180} rounded="md" />
            <SkeletonRows rows={3} cols={3} label={t('terms.loading')} />
          </>
        ) : (
          <ErrorState message={verdict(terms.error, t)} retry={() => void terms.refetch()} />
        )}
      </div>
    );
  }
  const tv = terms.data;
  return (
    <div className="rm-page">
      <PageHeader
        title={t('terms.title')}
        subtitle={t('terms.subtitle', { seller: tv.sellerCompanyName, store: tv.storeName })}
      />
      {tv.current === null ? (
        <EmptyState
          icon={<FileSignature size={22} />}
          title={t('terms.none.title')}
          description={t('terms.none.body', { seller: tv.sellerCompanyName })}
        />
      ) : (
        <CurrentCard terms={tv} canAccept={can(me, 'terms.accept')} />
      )}
      <HistorySection terms={tv} />
    </div>
  );
}

function CurrentCard({
  terms,
  canAccept,
}: {
  terms: StoreTermsView;
  canAccept: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
  const toast = useToast();
  const accept = useAcceptTerms();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = terms.current;
  if (c === null) return <></>;

  async function doAccept(versionId: string, version: number): Promise<void> {
    setError(null);
    try {
      await accept.mutateAsync({ versionId });
      toast.success(t('terms.accepted.toast', { version }));
      setConfirming(false);
    } catch (err) {
      setError(verdict(err, t));
      setConfirming(false);
    }
  }

  return (
    <section className="rm-card" aria-labelledby="terms-current">
      <div className="rm-card__head">
        <span className="rm-card__chip" aria-hidden>
          <FileSignature size={18} />
        </span>
        <div className="rm-card__titles">
          <h2 id="terms-current" className="rm-card__title">
            {t('terms.version', { version: c.version })}
          </h2>
          <p className="rm-card__sub">
            {c.acceptance === null
              ? t('terms.sub.notAccepted', {
                  seller: terms.sellerCompanyName,
                  when: when(c.publishedAt),
                })
              : t('terms.sub.accepted', {
                  name: c.acceptance.acceptedByName,
                  when: when(c.acceptance.acceptedAt),
                })}
          </p>
        </div>
        <div className="rm-card__aside">
          {c.acceptance === null ? (
            <StatusChip kind="pending" label={t('terms.chip.notAccepted')} size="sm" />
          ) : (
            <StatusChip kind="confirmed" label={t('terms.chip.accepted')} size="sm" />
          )}
        </div>
      </div>

      {terms.needsRevision !== null ? (
        <RmCallout tone="critical" icon={<TriangleAlert size={16} />} role="alert">
          <p>{terms.needsRevision}</p>
        </RmCallout>
      ) : null}

      <div className="rm-terms">
        <div className="rm-terms__block">
          <h3 className="rm-terms__heading">{t('terms.block.fees')}</h3>
          <ul className="rm-terms__list">
            {c.shares.map((s) => (
              <li key={s.feeType} className="rm-terms__item">
                <Check size={14} className="rm-terms__tick" aria-hidden />
                <span>{s.words}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rm-terms__block">
          <h3 className="rm-terms__heading">{t('terms.block.credit')}</h3>
          <ul className="rm-terms__list">
            <li className="rm-terms__item">
              <Check size={14} className="rm-terms__tick" aria-hidden />
              <span>{c.storeCredit.words}</span>
            </li>
            <li className="rm-terms__item">
              <Check size={14} className="rm-terms__tick" aria-hidden />
              <span>{c.sellerCredit.words}</span>
            </li>
          </ul>
        </div>
      </div>

      {c.note !== null ? (
        <RmCallout tone="info" icon={<Quote size={16} />}>
          <p>
            <span className="rm-strong">
              {t('terms.says', { seller: terms.sellerCompanyName })}
            </span>{' '}
            {c.note}
          </p>
        </RmCallout>
      ) : null}

      <Table caption={t('terms.examples.caption')}>
        <THead>
          <Tr>
            <Th>{t('terms.col.fee')}</Th>
            <Th>{t('terms.col.example')}</Th>
            <Th>{t('terms.col.youPay')}</Th>
            <Th>{t('terms.col.sellerPays', { seller: terms.sellerCompanyName })}</Th>
          </Tr>
        </THead>
        <TBody>
          {terms.examples.map((e) => (
            <Tr key={e.feeType}>
              <Td>{e.label}</Td>
              <Td>
                {e.basis} (<Money amount={e.feeInr} convert={false} />)
              </Td>
              <Td>
                <Money amount={e.storeInr} convert={false} />
              </Td>
              <Td>
                <Money amount={e.sellerInr} convert={false} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <p className="rm-muted rm-faint">{terms.rounding}</p>
      {error !== null ? <RmAlert>{error}</RmAlert> : null}
      {c.acceptance === null ? (
        canAccept ? (
          <div className="rm-form__actions">
            <Button
              variant="primary"
              size="md"
              icon={<FileSignature size={15} />}
              onClick={() => setConfirming(true)}
            >
              {t('terms.acceptVersion', { version: c.version })}
            </Button>
          </div>
        ) : (
          <p className="rm-muted">{t('terms.needsAdmin')}</p>
        )
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('terms.confirm.title', { version: c.version, store: terms.storeName })}
        entity={t('terms.confirm.entity', {
          store: terms.storeName,
          version: c.version,
          seller: terms.sellerCompanyName,
        })}
        consequence={t('terms.confirm.consequence')}
        confirmLabel={t('terms.confirm.accept')}
        onConfirm={() => doAccept(c.id, c.version)}
      />
    </section>
  );
}

function HistorySection({ terms }: { terms: StoreTermsView }): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
  return (
    <RmSection>
      <SectionHeading title={t('terms.history.title')} note={t('terms.history.note')} />
      {terms.history.length === 0 ? (
        <EmptyState icon={<History size={22} />} title={t('terms.history.empty')} />
      ) : (
        <Table caption={t('terms.history.title')}>
          <THead>
            <Tr>
              <Th>{t('terms.history.col.version')}</Th>
              <Th>{t('terms.history.col.published')}</Th>
              <Th>{t('terms.history.col.accepted')}</Th>
            </Tr>
          </THead>
          <TBody>
            {terms.history.map((v) => (
              <Tr key={v.id}>
                <Td className="sk-figure">{v.version}</Td>
                <Td className="rm-when sk-figure">{when(v.publishedAt)}</Td>
                <Td>
                  {v.acceptance === null
                    ? '—'
                    : `${v.acceptance.acceptedByName}, ${when(v.acceptance.acceptedAt)}`}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </RmSection>
  );
}
