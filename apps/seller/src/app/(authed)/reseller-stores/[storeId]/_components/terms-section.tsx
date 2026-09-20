'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  BandBody,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Money,
  SectionBand,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  CREDIT_TRIGGERS,
  FEE_FIELDS,
  usePublishTerms,
  useResellerStoreTerms,
  useTermsPreview,
  type CreditTrigger,
  type FeeExample,
  type StoreTerms,
  type TermsDraft,
  type TermsVersion,
} from '@/lib/reseller-terms-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function draftFrom(v: TermsVersion | null): TermsDraft {
  const pct = (feeType: string): string => {
    const s = v?.shares.find((x) => x.feeType === feeType)?.storePercent;
    return s === undefined ? '0' : String(Number(s));
  };
  return {
    deliveryFeeStorePercent: pct('DELIVERY_FEE'),
    returnFeeStorePercent: pct('RETURN_FEE'),
    customerReturnFeeStorePercent: pct('CUSTOMER_RETURN_FEE'),
    codFeeStorePercent: pct('COD_FEE'),
    codTaxStorePercent: pct('COD_TAX'),
    instantPayFeeStorePercent: pct('INSTANT_PAY_FEE'),
    storeCreditTrigger: v?.storeCredit.trigger ?? 'ON_PAYOUT',
    storeCreditDays: v?.storeCredit.days ?? 0,
    sellerCreditTrigger: v?.sellerCredit.trigger ?? 'ON_PAYOUT',
    sellerCreditDays: v?.sellerCredit.days ?? 0,
  };
}

/** The draft, but only once the typing has paused — one preview per pause, not per key. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * RS-4 — the store's terms on the seller's store page: the version in
 * force and whether the store accepted it, a worked example from the
 * API's own arithmetic, a form to publish the next version, and every
 * version so far.
 */
export function TermsSection({
  storeId,
  final,
}: {
  storeId: string;
  final: boolean;
}): ReactElement {
  const terms = useResellerStoreTerms(storeId);
  const identity = useSellerIdentity();
  // COSMETIC (FE-2): the API refuses a publish without `stores.pricing`.
  const canPublish = can(identity, 'stores.pricing') && !final;

  if (terms.isPending) return <LoadingState label="Loading the terms" rows={4} />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  return (
    <div>
      <CurrentTermsCard terms={t} />
      {canPublish ? <PublishCard storeId={storeId} terms={t} /> : null}
      <HistorySection terms={t} canPublish={canPublish} />
    </div>
  );
}

function CurrentTermsCard({ terms }: { terms: StoreTerms }): ReactElement {
  const c = terms.current;
  /*
    `== null`, not `=== null`.

    The type says `TermsVersion | null`, and the guard read `=== null`
    for as long as this component has existed — but the server OMITS the
    key on a store with no terms rather than sending null, so `c` is
    `undefined`, the guard lets it through and `c.version` throws. The
    whole Terms tab was an error boundary on every such store (found on
    a CLOSED QA store while converting this page). A loose check covers
    both spellings of "there are none", which is the only thing this
    branch is asking.
  */
  if (c == null) {
    return (
      <div>
        <SectionBand index="01" title="Terms in force" note="None published yet." />
        <BandBody flush className="mb-4">
          <EmptyState
            bare
            title="Publish the store’s first terms"
            description="Say who pays which Skydrop fee and when each of you is credited. The store cannot place orders until it has accepted a version."
          />
        </BandBody>
      </div>
    );
  }
  return (
    <div>
      <SectionBand
        index="01"
        title={`Version ${c.version} — in force`}
        note={
          c.acceptance === null
            ? `Published ${when(c.publishedAt)}. Waiting for ${terms.storeName} to accept it.`
            : `Published ${when(c.publishedAt)}. Accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}.`
        }
      />
      <BandBody className="mb-4">
        <div className="space-y-4">
          {terms.needsRevision !== null ? (
            <p
              role="alert"
              className="border-border bg-surface-raised text-critical rounded-lg border px-3 py-2 text-sm"
            >
              {terms.needsRevision}
            </p>
          ) : null}
          <ExampleTable examples={terms.examples} storeName={terms.storeName} />
          <ul className="space-y-1 text-sm">
            <li>{c.storeCredit.words}</li>
            <li>{c.sellerCredit.words}</li>
          </ul>
          {c.note !== null ? <p className="text-text-muted text-sm">Note: {c.note}</p> : null}
          <p className="text-text-muted text-xs">{terms.rounding}</p>
        </div>
      </BandBody>
    </div>
  );
}

function ExampleTable({
  examples,
  storeName,
}: {
  examples: readonly FeeExample[];
  storeName: string;
}): ReactElement {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Fee</Th>
          <Th>Worked on</Th>
          <Th>{storeName} pays</Th>
          <Th>You pay</Th>
        </Tr>
      </THead>
      <TBody>
        {examples.map((e) => (
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
  );
}

function PublishCard({ storeId, terms }: { storeId: string; terms: StoreTerms }): ReactElement {
  const toast = useToast();
  const publish = usePublishTerms(storeId);
  const [draft, setDraft] = useState<TermsDraft>(() => draftFrom(terms.current));
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useSettled(draft, 350);
  const preview = useTermsPreview(storeId, settled);
  const nextVersion = (terms.current?.version ?? 0) + 1;
  const delivery = preview.data?.examples.find((e) => e.feeType === 'DELIVERY_FEE');

  function set<K extends keyof TermsDraft>(key: K, value: TermsDraft[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function triggerOptions(): ReactElement[] {
    return CREDIT_TRIGGERS.map((o) => (
      <option key={o.value} value={o.value}>
        {o.value === 'AFTER_CONFIRMATION' && !terms.afterConfirmationEnabled
          ? `${o.label} — needs Skydrop to enable it`
          : o.label}
      </option>
    ));
  }

  async function doPublish(): Promise<void> {
    setError(null);
    try {
      await publish.mutateAsync({
        ...draft,
        note: note.trim() === '' ? undefined : note.trim(),
        basedOnVersion: terms.current?.version ?? 0,
      });
      toast.success(`Version ${nextVersion} published. ${terms.storeName} must accept it next.`);
      setConfirming(false);
      setNote('');
    } catch (err) {
      setError(serverVerdict(err));
      setConfirming(false);
    }
  }

  return (
    <div>
      <SectionBand
        index="02"
        title={
          terms.current === null ? 'Publish the first terms' : `Publish version ${nextVersion}`
        }
        note="For each Skydrop fee, the percentage the STORE pays — you pay the rest. Inbound freight is always yours."
      />
      <BandBody className="mb-4">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEE_FIELDS.map((f) => (
              <FormField
                key={f.field}
                label={`${f.label} — store pays (%)`}
                htmlFor={`tf-${f.field}`}
              >
                <Input
                  id={`tf-${f.field}`}
                  inputMode="decimal"
                  value={draft[f.field]}
                  onChange={(e) => set(f.field, e.target.value)}
                />
              </FormField>
            ))}
          </div>

          <p role="status" aria-live="polite" className="text-sm">
            {delivery === undefined ? (
              preview.isError ? (
                <span className="text-critical">{serverVerdict(preview.error)}</span>
              ) : (
                'Working out an example…'
              )
            ) : (
              <>
                On a <Money amount={delivery.feeInr} convert={false} /> delivery fee{' '}
                {terms.storeName} pays <Money amount={delivery.storeInr} convert={false} />, you pay{' '}
                <Money amount={delivery.sellerInr} convert={false} />.
              </>
            )}
          </p>
          {preview.data !== undefined ? (
            <ExampleTable examples={preview.data.examples} storeName={terms.storeName} />
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">When {terms.storeName} is credited</legend>
              <FormField label="Credited" htmlFor="tf-store-trigger">
                <Select
                  id="tf-store-trigger"
                  value={draft.storeCreditTrigger}
                  onChange={(e) => set('storeCreditTrigger', e.target.value as CreditTrigger)}
                >
                  {triggerOptions()}
                </Select>
              </FormField>
              <FormField label="Days" htmlFor="tf-store-days">
                <Input
                  id="tf-store-days"
                  type="number"
                  min={0}
                  max={365}
                  value={String(draft.storeCreditDays)}
                  onChange={(e) => set('storeCreditDays', Number(e.target.value))}
                />
              </FormField>
              {preview.data?.storeCredit ? (
                <p className="text-text-muted text-sm">{preview.data.storeCredit.words}</p>
              ) : null}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">When you are credited</legend>
              <FormField label="Credited" htmlFor="tf-seller-trigger">
                <Select
                  id="tf-seller-trigger"
                  value={draft.sellerCreditTrigger}
                  onChange={(e) => set('sellerCreditTrigger', e.target.value as CreditTrigger)}
                >
                  {triggerOptions()}
                </Select>
              </FormField>
              <FormField label="Days" htmlFor="tf-seller-days">
                <Input
                  id="tf-seller-days"
                  type="number"
                  min={0}
                  max={365}
                  value={String(draft.sellerCreditDays)}
                  onChange={(e) => set('sellerCreditDays', Number(e.target.value))}
                />
              </FormField>
              {preview.data?.sellerCredit ? (
                <p className="text-text-muted text-sm">{preview.data.sellerCredit.words}</p>
              ) : null}
            </fieldset>
          </div>

          <FormField label="Note to the store (optional)" htmlFor="tf-note" hint="What changed.">
            <Textarea id="tf-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>

          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <div>
            <Button variant="primary" size="md" onClick={() => setConfirming(true)}>
              Publish version {nextVersion}
            </Button>
          </div>
        </div>
      </BandBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Publish version ${nextVersion}?`}
        description={`${terms.storeName} must accept it before its next order. Orders already placed keep the terms they were placed under.`}
        confirmLabel="Publish"
        disabled={publish.isPending}
        onConfirm={() => void doPublish()}
      />
    </div>
  );
}

/**
 * The ordinal shifts with whether the publish form is on the page: a
 * reader who cannot publish sees "01 // in force" then "02 // every
 * version", and numbering the history 03 with no 02 above it reads as
 * a section that failed to render.
 */
function HistorySection({
  terms,
  canPublish,
}: {
  terms: StoreTerms;
  canPublish: boolean;
}): ReactElement {
  return (
    <div>
      <SectionBand
        index={canPublish ? '03' : '02'}
        title="Every version"
        note="Newest first. A version is never edited once published."
      />
      <BandBody flush>
        {terms.history.length === 0 ? (
          <EmptyState bare title="No versions yet" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Version</Th>
                <Th>Published</Th>
                <Th>Store pays</Th>
                <Th>Credit</Th>
                <Th>Accepted</Th>
              </Tr>
            </THead>
            <TBody>
              {terms.history.map((v) => (
                <Tr key={v.id}>
                  <Td>{v.version}</Td>
                  <Td>{when(v.publishedAt)}</Td>
                  <Td>
                    {v.shares.map((s) => `${s.label} ${Number(s.storePercent)}%`).join(' · ')}
                  </Td>
                  <Td>
                    Store: {v.storeCredit.label}
                    {v.storeCredit.days > 0 ? ` (${v.storeCredit.days}d)` : ''} · You:{' '}
                    {v.sellerCredit.label}
                    {v.sellerCredit.days > 0 ? ` (${v.sellerCredit.days}d)` : ''}
                  </Td>
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
      </BandBody>
    </div>
  );
}
