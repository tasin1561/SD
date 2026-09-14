'use client';

import { useState, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useAcceptTerms, useStoreTerms, type StoreTermsView } from '@/lib/terms-hooks';

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

  if (terms.isPending) return <LoadingState label="Loading the terms" rows={4} />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Terms"
        subtitle={`What ${t.sellerCompanyName} and ${t.storeName} have agreed about Skydrop’s fees and when each of you is paid.`}
      />
      {t.current === null ? (
        <EmptyState
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
    <Card>
      <CardHeader
        title={`Version ${c.version}`}
        subtitle={
          c.acceptance === null
            ? `Published by ${terms.sellerCompanyName} on ${when(c.publishedAt)} — not accepted yet. Your store cannot place new orders until it is.`
            : `Accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}.`
        }
      />
      <CardBody>
        <div className="space-y-4">
          {terms.needsRevision !== null ? (
            <p
              role="alert"
              className="border-border bg-surface-raised text-critical rounded-lg border px-3 py-2 text-sm"
            >
              {terms.needsRevision}
            </p>
          ) : null}
          <div>
            <h3 className="mb-1 text-sm font-medium">Who pays which fee</h3>
            <ul className="space-y-1 text-sm">
              {c.shares.map((s) => (
                <li key={s.feeType}>{s.words}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">When each of you is credited</h3>
            <ul className="space-y-1 text-sm">
              <li>{c.storeCredit.words}</li>
              <li>{c.sellerCredit.words}</li>
            </ul>
          </div>
          {c.note !== null ? (
            <p className="text-sm">
              <span className="font-medium">{terms.sellerCompanyName} says:</span> {c.note}
            </p>
          ) : null}
          <Table>
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
          <p className="text-text-muted text-xs">{terms.rounding}</p>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          {c.acceptance === null ? (
            canAccept ? (
              <Button variant="primary" size="md" onClick={() => setConfirming(true)}>
                Accept version {c.version}
              </Button>
            ) : (
              <p className="text-text-muted text-sm">
                Somebody at your store who may accept terms (an owner or admin) needs to accept this
                version.
              </p>
            )
          ) : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Accept version ${c.version} for ${terms.storeName}?`}
        description="Every order your store places from now on is priced and paid under these terms. Your name, the time and where you accepted from are recorded."
        confirmLabel="Accept"
        disabled={accept.isPending}
        onConfirm={() => void doAccept(c.id, c.version)}
      />
    </Card>
  );
}

function HistorySection({ terms }: { terms: StoreTermsView }): ReactElement {
  return (
    <Section
      title="Every version"
      subtitle="Newest first. A version is never changed once published."
    >
      {terms.history.length === 0 ? (
        <EmptyState title="Nothing yet" />
      ) : (
        <Table>
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
                <Td>{v.version}</Td>
                <Td>{when(v.publishedAt)}</Td>
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
    </Section>
  );
}
