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
import { serverVerdict } from '@/lib/server-verdict';
import { useAcceptTerms, useStoreTerms, type StoreTermsView } from '@/lib/terms-hooks';
import { RmAlert, RmCallout, RmSection } from '../wallet/_components/rm-parts';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-4 — the seller's terms for this store, in plain words: who pays which
 * Skydrop fee on your orders, when you and the seller are credited, and
 * the button that agrees to them on the store's behalf.
 */
export default function TermsPage(): ReactElement {
  const me = useStoreIdentity();
  const terms = useStoreTerms();

  if (terms.isPending || terms.isError) {
    return (
      <div className="rm-page">
        <PageHeader
          title="Terms"
          subtitle="Who pays which Skydrop fee on your orders, and when you and your seller are paid."
        />
        {terms.isPending ? (
          <>
            <Skeleton className="rm-kpi-skel" height={180} rounded="md" />
            <SkeletonRows rows={3} cols={3} label="Loading the terms" />
          </>
        ) : (
          <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />
        )}
      </div>
    );
  }
  const t = terms.data;
  return (
    <div className="rm-page">
      <PageHeader
        title="Terms"
        subtitle={`What ${t.sellerCompanyName} and ${t.storeName} have agreed about Skydrop’s fees and when each of you is paid.`}
      />
      {t.current === null ? (
        <EmptyState
          icon={<FileSignature size={22} />}
          title="No terms yet"
          description={`${t.sellerCompanyName} has not published terms for your store. You can place orders once they have, and you have accepted them.`}
        />
      ) : (
        <CurrentCard terms={t} canAccept={can(me, 'terms.accept')} />
      )}
      <HistorySection terms={t} />
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
      toast.success(`Version ${version} accepted.`);
      setConfirming(false);
    } catch (err) {
      setError(serverVerdict(err));
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
            {`Version ${c.version}`}
          </h2>
          <p className="rm-card__sub">
            {c.acceptance === null
              ? `Published by ${terms.sellerCompanyName} on ${when(c.publishedAt)} — not accepted yet. Your store cannot place new orders until it is.`
              : `Accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}.`}
          </p>
        </div>
        <div className="rm-card__aside">
          {c.acceptance === null ? (
            <StatusChip kind="pending" label="Not accepted yet" size="sm" />
          ) : (
            <StatusChip kind="confirmed" label="Accepted" size="sm" />
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
          <h3 className="rm-terms__heading">Who pays which fee</h3>
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
          <h3 className="rm-terms__heading">When each of you is credited</h3>
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
            <span className="rm-strong">{terms.sellerCompanyName} says:</span> {c.note}
          </p>
        </RmCallout>
      ) : null}

      <Table caption="What each fee would cost, for example">
        <THead>
          <Tr>
            <Th>Fee</Th>
            <Th>For example</Th>
            <Th>You pay</Th>
            <Th>{terms.sellerCompanyName} pays</Th>
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
              Accept version {c.version}
            </Button>
          </div>
        ) : (
          <p className="rm-muted">
            Somebody at your store who may accept terms (an owner or admin) needs to accept this
            version.
          </p>
        )
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Accept version ${c.version} for ${terms.storeName}?`}
        entity={`${terms.storeName} · version ${c.version} from ${terms.sellerCompanyName}`}
        consequence="Every order your store places from now on is priced and paid under these terms. Your name, the time and where you accepted from are recorded."
        confirmLabel="Accept"
        onConfirm={() => doAccept(c.id, c.version)}
      />
    </section>
  );
}

function HistorySection({ terms }: { terms: StoreTermsView }): ReactElement {
  return (
    <RmSection>
      <SectionHeading
        title="Every version"
        note="Newest first. A version is never changed once published."
      />
      {terms.history.length === 0 ? (
        <EmptyState icon={<History size={22} />} title="Nothing yet" />
      ) : (
        <Table caption="Every version">
          <THead>
            <Tr>
              <Th>Version</Th>
              <Th>Published</Th>
              <Th>Accepted</Th>
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
