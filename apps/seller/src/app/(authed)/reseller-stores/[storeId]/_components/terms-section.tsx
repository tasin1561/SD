'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { CalendarCheck, FileSignature, History, TriangleAlert } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { RsCallout, RsError, RsSection } from '../../_components/rs-parts';

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

  if (terms.isPending) return <SkeletonRows rows={4} cols={4} label="Loading the terms" />;
  if (terms.isError) {
    return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
  }
  const t = terms.data;
  return (
    <>
      <CurrentTermsCard terms={t} />
      {canPublish ? <PublishCard storeId={storeId} terms={t} /> : null}
      <HistorySection terms={t} />
    </>
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
      <RsSection title="Terms in force" note="None published yet." flush>
        <EmptyState
          bare
          icon={<FileSignature size={22} />}
          title="Publish the store’s first terms"
          description="Say who pays which Skydrop fee and when each of you is credited. The store cannot place orders until it has accepted a version."
        />
      </RsSection>
    );
  }
  return (
    <RsSection
      title={
        <span className="rs-row">
          <FileSignature size={16} aria-hidden />
          {`Version ${c.version} — in force`}
        </span>
      }
      note={
        c.acceptance === null
          ? `Published ${when(c.publishedAt)}. Waiting for ${terms.storeName} to accept it.`
          : `Published ${when(c.publishedAt)}. Accepted by ${c.acceptance.acceptedByName} on ${when(c.acceptance.acceptedAt)}.`
      }
    >
      <div className="rs-stack">
        {terms.needsRevision !== null ? (
          <RsCallout tone="critical" icon={<TriangleAlert size={16} />} role="alert">
            <p>{terms.needsRevision}</p>
          </RsCallout>
        ) : null}
        <ExampleTable examples={terms.examples} storeName={terms.storeName} />
        <ul className="rs-credits">
          <li>
            <span className="rs-credits__chip" aria-hidden>
              <CalendarCheck size={14} />
            </span>
            {c.storeCredit.words}
          </li>
          <li>
            <span className="rs-credits__chip" aria-hidden>
              <CalendarCheck size={14} />
            </span>
            {c.sellerCredit.words}
          </li>
        </ul>
        {c.note !== null ? <p className="rs-muted">Note: {c.note}</p> : null}
        <p className="rs-faint">{terms.rounding}</p>
      </div>
    </RsSection>
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
    <Table caption="Who pays each fee, worked through">
      <THead>
        <Tr>
          <Th>Fee</Th>
          <Th>Worked on</Th>
          <Th align="right">{storeName} pays</Th>
          <Th align="right">You pay</Th>
        </Tr>
      </THead>
      <TBody>
        {examples.map((e) => (
          <Tr key={e.feeType}>
            <Td className="rs-strong">{e.label}</Td>
            <Td className="rs-small">
              {e.basis} (<Money amount={e.feeInr} convert={false} />)
            </Td>
            <Td align="right">
              <Money amount={e.storeInr} convert={false} />
            </Td>
            <Td align="right">
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
    <RsSection
      title={terms.current === null ? 'Publish the first terms' : `Publish version ${nextVersion}`}
      note="For each Skydrop fee, the percentage the STORE pays — you pay the rest. Inbound freight is always yours."
    >
      <div className="rs-stack">
        <div className="rs-grid-3">
          {FEE_FIELDS.map((f) => (
            <TextField
              key={f.field}
              id={`tf-${f.field}`}
              label={`${f.label} — store pays (%)`}
              inputMode="decimal"
              inputClassName="sk-figure"
              value={draft[f.field]}
              onChange={(e) => set(f.field, e.target.value)}
            />
          ))}
        </div>

        <p role="status" aria-live="polite" className="rs-preview">
          {delivery === undefined ? (
            preview.isError ? (
              <span className="rs-error">{serverVerdict(preview.error)}</span>
            ) : (
              'Working out an example…'
            )
          ) : (
            <>
              On a <Money amount={delivery.feeInr} convert={false} /> delivery fee {terms.storeName}{' '}
              pays <Money amount={delivery.storeInr} convert={false} />, you pay{' '}
              <Money amount={delivery.sellerInr} convert={false} />.
            </>
          )}
        </p>
        {preview.data !== undefined ? (
          <ExampleTable examples={preview.data.examples} storeName={terms.storeName} />
        ) : null}

        <div className="rs-grid-2">
          <fieldset className="rs-fieldset">
            <legend>When {terms.storeName} is credited</legend>
            <Select
              id="tf-store-trigger"
              label="Credited"
              value={draft.storeCreditTrigger}
              onChange={(e) => set('storeCreditTrigger', e.target.value as CreditTrigger)}
            >
              {triggerOptions()}
            </Select>
            <TextField
              id="tf-store-days"
              label="Days"
              type="number"
              min={0}
              max={365}
              inputClassName="sk-figure"
              value={String(draft.storeCreditDays)}
              onChange={(e) => set('storeCreditDays', Number(e.target.value))}
            />
            {preview.data?.storeCredit ? (
              <p className="rs-muted">{preview.data.storeCredit.words}</p>
            ) : null}
          </fieldset>
          <fieldset className="rs-fieldset">
            <legend>When you are credited</legend>
            <Select
              id="tf-seller-trigger"
              label="Credited"
              value={draft.sellerCreditTrigger}
              onChange={(e) => set('sellerCreditTrigger', e.target.value as CreditTrigger)}
            >
              {triggerOptions()}
            </Select>
            <TextField
              id="tf-seller-days"
              label="Days"
              type="number"
              min={0}
              max={365}
              inputClassName="sk-figure"
              value={String(draft.sellerCreditDays)}
              onChange={(e) => set('sellerCreditDays', Number(e.target.value))}
            />
            {preview.data?.sellerCredit ? (
              <p className="rs-muted">{preview.data.sellerCredit.words}</p>
            ) : null}
          </fieldset>
        </div>

        <TextArea
          id="tf-note"
          label="Note to the store (optional)"
          hint="What changed."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error !== null ? <RsError>{error}</RsError> : null}
        <div>
          <Button
            variant="primary"
            size="md"
            icon={<FileSignature size={15} />}
            onClick={() => setConfirming(true)}
          >
            Publish version {nextVersion}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Publish version ${nextVersion}?`}
        entity={terms.storeName}
        consequence={`${terms.storeName} must accept it before its next order. Orders already placed keep the terms they were placed under.`}
        confirmLabel="Publish"
        closeOnSuccess={false}
        onConfirm={doPublish}
      />
    </RsSection>
  );
}

/**
 * Every version, newest first. Section numbering is gone with the
 * restyle, so the history no longer needs to know whether the publish
 * form is on the page above it.
 */
function HistorySection({ terms }: { terms: StoreTerms }): ReactElement {
  return (
    <RsSection
      title={
        <span className="rs-row">
          <History size={16} aria-hidden />
          Every version
        </span>
      }
      note="Newest first. A version is never edited once published."
      flush
    >
      {terms.history.length === 0 ? (
        <EmptyState bare title="No versions yet" />
      ) : (
        <Table caption="Every version of the terms">
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
                <Td>
                  <span className="rs-version sk-figure">{v.version}</span>
                </Td>
                <Td className="rs-when sk-figure">{when(v.publishedAt)}</Td>
                <Td className="rs-small">
                  {v.shares.map((s) => `${s.label} ${Number(s.storePercent)}%`).join(' · ')}
                </Td>
                <Td className="rs-small">
                  Store: {v.storeCredit.label}
                  {v.storeCredit.days > 0 ? ` (${v.storeCredit.days}d)` : ''} · You:{' '}
                  {v.sellerCredit.label}
                  {v.sellerCredit.days > 0 ? ` (${v.sellerCredit.days}d)` : ''}
                </Td>
                <Td className="rs-small">
                  {v.acceptance === null
                    ? '—'
                    : `${v.acceptance.acceptedByName}, ${when(v.acceptance.acceptedAt)}`}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </RsSection>
  );
}
