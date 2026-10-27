'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Check, MapPin, MessageSquareWarning, Truck, X } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { verdict } from '@/i18n/verdict';
import {
  useDecideStoreAction,
  useDecideStoreAddressChange,
  useDecideStoreOrderRequest,
  useStoreActionRequests,
  useStoreAddressChanges,
  useStoreOrderRequests,
  type AddressField,
  type StoreActionRequestRow,
  type StoreAddressChangeRow,
  type StoreOrderRequestRow,
} from '@/lib/reseller-store-hooks';
import {
  RsError,
  RsFact,
  RsFacts,
  RsLink,
  RsSection,
  RsStrip,
  RsStripFact,
  pendingPhase,
} from '../_components/rs-parts';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { dateTag } from '@/i18n/format';
import type { Locale } from '@skydrop/ui/app/i18n';

function when(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleString(dateTag(locale, 'en-IN'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** What the store asked for, in the seller's words rather than an enum. */
const askedForOf = (t: Translate<MessageKey>): Record<StoreActionRequestRow['action'], string> => ({
  RECALL: t('resellerRequests.callTheCustomerAgain2'),
  REATTEMPT: t('resellerRequests.tryDeliveringItAgain'),
  RTO: t('resellerRequests.sendTheParcelBack'),
});

/**
 * What approving a delivery ask DOES, per ask — the same words the
 * store's "What they can do" screen uses for a direct action. Approving
 * runs exactly that, so the confirmation says it before it happens.
 */
const approveDoesOf = (
  t: Translate<MessageKey>,
): Record<StoreActionRequestRow['action'], string> => ({
  RECALL: t('resellerRequests.approvingRunsItNow'),
  REATTEMPT: t('resellerRequests.approvingRunsItNow2'),
  RTO: t('resellerRequests.approvingRunsItNow3'),
});

/**
 * 2026-09-16 — the one queue for everything your reseller stores are
 * waiting on: what they have asked to DO to a parcel, and what they have
 * asked to CHANGE on one.
 *
 * Only the ones your own policy marked “ask me first” stop here; the ones
 * you let through have already run. Nothing happens on any of them until
 * you answer, and the store has a customer waiting for that answer —
 * which is why a rejection needs a reason and the store is told either
 * way. Approving now asks first too (owner's decision), restating the
 * store, the order and what approving will do; only the confirmation
 * sends the SAME request as before.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   TIME LEFT BEFORE IT EXPIRES   a request does close itself after
 *       `reseller.store_request_expire_hours`, but that setting is not
 *       on any of these three payloads, so a countdown would be counting
 *       down to a deadline this page has guessed. The time it was ASKED
 *       is what the rows carry, and that is the column.
 *   SLA / RESPONSE TIME           nothing measures how long these take
 *       to answer, and putting a clock on it would be a promise we make
 *       nowhere else.
 */
export default function StoreRequestsPage(): ReactElement {
  const t = useT();
  // Asked here only to decide whether ALL queues are empty; the sections
  // ask again and read the same cache entry, so this costs no extra
  // request.
  const requests = useStoreActionRequests();
  const addresses = useStoreAddressChanges();
  const orderRequests = useStoreOrderRequests();

  const orderCount = orderRequests.data?.length;
  const actionCount = requests.data?.length;
  const addressCount = addresses.data?.length;
  const total = (orderCount ?? 0) + (actionCount ?? 0) + (addressCount ?? 0);
  const counted =
    orderCount !== undefined && actionCount !== undefined && addressCount !== undefined;

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: t('resellerRequests.clientConsole') },
        { label: t('resellerRequests.reselling') },
        { label: t('resellerRequests.waitingOnYou') },
      ]}
      Link={Link}
      title={t('resellerRequests.waitingOnYou')}
      subtitle={t('resellerRequests.whatYourMemberStores')}
      meta={
        !counted ? undefined : (
          <RsFacts>
            <RsFact tone={total > 0 ? 'warn' : 'good'} dot={total > 0}>
              {total === 0
                ? t('resellerRequests.nothingWaiting')
                : t('resellerRequests.waiting', { total })}
            </RsFact>
          </RsFacts>
        )
      }
      action={<RsLink href="/reseller-stores">{t('resellerRequests.allMemberStores')}</RsLink>}
    />
  );

  /*
    One card per QUEUE, each counting the rows its own section renders.
    A single "waiting" number would not say which desk the work is on,
    and the three want different answers: a cancel is a decision, an
    order change is a comparison, a delivery ask spends money. Plain
    counts, so each rolls up once.
  */
  const tiles = counted ? (
    <div className="rs-kpis">
      <KpiCard
        label={t('resellerRequests.cancelsCallQuestionsIssues')}
        icon={<MessageSquareWarning size={14} />}
        value={orderCount ?? 0}
        unit={orderCount === 1 ? 'request' : 'requests'}
        tone={(orderCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint={t('resellerRequests.approvingRunsItExactly')}
      />
      <KpiCard
        label={t('resellerRequests.deliveryAsks')}
        icon={<Truck size={14} />}
        value={actionCount ?? 0}
        unit={actionCount === 1 ? 'ask' : 'asks'}
        tone={(actionCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint={t('resellerRequests.callAgainDeliverAgain')}
      />
      <KpiCard
        label={t('resellerRequests.orderAndAddressChanges')}
        icon={<MapPin size={14} />}
        value={addressCount ?? 0}
        unit={addressCount === 1 ? 'change' : 'changes'}
        tone={(addressCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint={t('resellerRequests.untilYouAnswerThe')}
      />
    </div>
  ) : null;

  // All still loading: one skeleton rather than three stacked.
  if (requests.isPending && addresses.isPending && orderRequests.isPending) {
    return (
      <div className="rs-page">
        {header}
        <div className="rs-kpis">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
          ))}
        </div>
        <SkeletonRows rows={4} cols={6} label={t('resellerRequests.loadingWhatYourStores')} />
      </div>
    );
  }

  // An empty queue is the ordinary state, and it reads far better as one
  // sentence than as three empty tables. It is the GOOD state, so it is
  // drawn as the positive empty state.
  const allEmpty =
    requests.data !== undefined &&
    requests.data.length === 0 &&
    addresses.data !== undefined &&
    addresses.data.length === 0 &&
    orderRequests.data !== undefined &&
    orderRequests.data.length === 0;

  return (
    <div className="rs-page">
      {header}
      {tiles}
      {allEmpty ? (
        <EmptyState
          tone="positive"
          title={t('resellerRequests.nothingIsWaiting')}
          description={t('resellerRequests.whenAMemberStore')}
          action={
            <RsLink href="/reseller-stores">{t('resellerRequests.changeWhatYourStores')}</RsLink>
          }
        />
      ) : (
        <>
          <OrderRequestsSection />
          <ActionRequestsSection />
          <AddressChangesSection />
          {counted && (
            <RsStrip>
              <RsStripFact
                label={t('resellerRequests.waiting2')}
                value={total}
                tone={total > 0 ? 'warn' : 'good'}
              />
              <RsStripFact label={t('resellerRequests.cancelsIssues')} value={orderCount ?? 0} />
              <RsStripFact label={t('resellerRequests.deliveryAsks')} value={actionCount ?? 0} />
              <RsStripFact label={t('resellerRequests.changes')} value={addressCount ?? 0} />
            </RsStrip>
          )}
        </>
      )}
    </div>
  );
}

/** The two answer buttons and the row's verdict, shared by all three queues. */
function AnswerCell({
  busy,
  onApprove,
  onReject,
  error,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  error: string | null;
}): ReactElement {
  const t = useT();
  return (
    <div className="rs-answer">
      <div className="rs-actions">
        <Button
          variant="primary"
          size="sm"
          icon={<Check size={13} />}
          disabled={busy}
          onClick={onApprove}
        >
          {t('resellerRequests.approve')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<X size={13} />}
          disabled={busy}
          onClick={onReject}
        >
          {t('resellerRequests.reject')}
        </Button>
      </div>
      {error !== null ? <RsError compact>{error}</RsError> : null}
    </div>
  );
}

/** An order number in the identifier face, with its status chip under it. */
function OrderCell({
  number,
  status,
  extra,
}: {
  number: string | null;
  status?: Parameters<typeof orderStatusKind>[0] | undefined;
  extra?: string | undefined;
}): ReactElement {
  const locale = useLocale();
  return (
    <>
      <span className="sk-ident">{number ?? '—'}</span>
      {status !== undefined ? (
        <div className="rs-block">
          <StatusChip
            kind={orderStatusKind(status)}
            label={statusLabel(status, locale)}
            size="sm"
          />
        </div>
      ) : null}
      {extra !== undefined ? <div className="rs-small">{extra}</div> : null}
    </>
  );
}

/**
 * A Reseller store's cancel, answer to "keep trying?", or issue for
 * Skydrop — held because the store's policy says Seller staff approve it
 * first. Approving runs it exactly as if the store had been allowed to do
 * it directly; the reply says whether it actually happened.
 */
function OrderRequestsSection(): ReactElement {
  const t = useT();
  const rows = useStoreOrderRequests();
  const [rejecting, setRejecting] = useState<StoreOrderRequestRow | null>(null);

  return (
    <RsSection
      title={t('resellerRequests.cancelsCallQuestionsAnd')}
      note={t('resellerRequests.callAnOrderOff')}
      flush
    >
      {rows.isPending ? (
        <SkeletonRows rows={2} cols={6} label={t('resellerRequests.loadingRequests')} />
      ) : rows.isError ? (
        <div className="rs-card__pad">
          <ErrorState message={verdict(rows.error, t)} retry={() => void rows.refetch()} />
        </div>
      ) : rows.data.length === 0 ? (
        <EmptyState bare tone="positive" title={t('resellerRequests.nothingToAnswerHere')} />
      ) : (
        <Table caption={t('resellerRequests.cancelsCallQuestionsAnd')}>
          <THead>
            <Tr>
              <Th>{t('resellerRequests.store')}</Th>
              <Th>{t('resellerRequests.order')}</Th>
              <Th>{t('resellerRequests.theyAskedTo')}</Th>
              <Th>{t('resellerRequests.whatTheySaid')}</Th>
              <Th>{t('resellerRequests.asked')}</Th>
              <Th>{t('resellerRequests.yourAnswer')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.data.map((r) => (
              <OrderRequestRow key={r.id} request={r} onReject={() => setRejecting(r)} />
            ))}
          </TBody>
        </Table>
      )}
      <RejectOrderRequestModal request={rejecting} onClose={() => setRejecting(null)} />
    </RsSection>
  );
}

function OrderRequestRow({
  request,
  onReject,
}: {
  request: StoreOrderRequestRow;
  onReject: () => void;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const decide = useDecideStoreOrderRequest();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function approve(): Promise<void> {
    setError(null);
    try {
      const out = await decide.mutateAsync({ requestId: request.id, approve: true });
      if (out.status !== 'EXECUTED') {
        // Verbatim (FE-2): e.g. [NOT_CANCELLABLE] when the order was
        // packed while this waited.
        setError(out.failureReason ?? t('resellerRequests.youApprovedItBut'));
        toast.error(t('resellerRequests.approvedButItCould'));
        return;
      }
      toast.success(t('resellerRequests.approvedAndCarriedOut'));
    } catch (err) {
      // Verbatim (FE-2): STORE_REQUEST_ALREADY_DECIDED when somebody else
      // answered it first.
      setError(verdict(err, t));
    }
  }

  const order = request.order;
  const storeName = request.store?.displayName ?? request.store?.name ?? '—';
  return (
    <Tr>
      <Td className="rs-strong">{storeName}</Td>
      <Td>
        <OrderCell number={order?.orderNumber ?? null} status={order?.status} />
      </Td>
      <Td>
        <span className="rs-body rs-wrap">{request.label}</span>
      </Td>
      <Td>
        <span className="rs-small rs-wrap">{request.note ?? '—'}</span>
      </Td>
      <Td className="rs-when sk-figure">{when(request.createdAt, locale)}</Td>
      <Td>
        <AnswerCell
          busy={decide.isPending}
          onApprove={() => setConfirming(true)}
          onReject={onReject}
          error={error}
        />
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('resellerRequests.approveSRequest', { storeName })}
          entity={order?.orderNumber ?? t('resellerRequests.thisOrder')}
          entityIsIdentifier={order !== null}
          consequence={t('resellerRequests.approvingRunsItExactly2')}
          confirmLabel={t('resellerRequests.approve')}
          onConfirm={approve}
        >
          <p className="rs-muted">
            {richMessage(t('resellerRequests.theyAskedTo2'), { label: request.label })}
          </p>
        </ConfirmDialog>
      </Td>
    </Tr>
  );
}

/** The reason box every rejection needs, the same on all three queues. */
function ReasonDialog({
  open,
  title,
  description,
  fieldId,
  note,
  setNote,
  error,
  pending,
  onCancel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  fieldId: string;
  note: string;
  setNote: (v: string) => void;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onClose: () => void;
  onSubmit: () => void;
}): ReactElement {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      tone="critical"
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onCancel}>
            {t('resellerRequests.cancel')}
          </Button>
          <AsyncButton
            variant="destructive"
            size="md"
            disabled={note.trim() === ''}
            state={pendingPhase(pending)}
            labels={{ idle: t('resellerRequests.turnItDown'), busy: t('resellerRequests.sending') }}
            onClick={onSubmit}
          />
        </DialogFooter>
      }
    >
      <div className="rs-form">
        <TextArea
          id={fieldId}
          label={t('resellerRequests.yourReason')}
          rows={3}
          maxLength={2000}
          showCount
          // The old FormField drew the asterisk; the reason is insisted on by
          // the dialog's own check, never by a browser `required`.
          requiredMark
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null ? <RsError>{error}</RsError> : null}
      </div>
    </Dialog>
  );
}

function RejectOrderRequestModal({
  request,
  onClose,
}: {
  request: StoreOrderRequestRow | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const decide = useDecideStoreOrderRequest();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success(t('resellerRequests.turnedDownTheStore'));
      setNote('');
      onClose();
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? t('resellerRequests.turnItDown')
          : t('resellerRequests.turnDownOn', {
              label: request.label,
              order: request.order?.orderNumber ?? t('resellerRequests.thisOrder'),
            })
      }
      description={t('resellerRequests.theStoreReadsThis')}
      fieldId="reject-order-request-note"
      note={note}
      setNote={setNote}
      error={error}
      pending={decide.isPending}
      onCancel={onClose}
      onClose={() => {
        setNote('');
        setError(null);
        onClose();
      }}
      onSubmit={() => void submit()}
    />
  );
}

function ActionRequestsSection(): ReactElement {
  const t = useT();
  const requests = useStoreActionRequests();
  const [rejecting, setRejecting] = useState<StoreActionRequestRow | null>(null);

  return (
    <RsSection
      title={t('resellerRequests.deliveryAsks')}
      note={t('resellerRequests.callTheCustomerAgain')}
      flush
    >
      {requests.isPending ? (
        <SkeletonRows rows={2} cols={6} label={t('resellerRequests.loadingAsks')} />
      ) : requests.isError ? (
        <div className="rs-card__pad">
          <ErrorState message={verdict(requests.error, t)} retry={() => void requests.refetch()} />
        </div>
      ) : requests.data.length === 0 ? (
        <EmptyState bare tone="positive" title={t('resellerRequests.nothingToAnswerHere')} />
      ) : (
        <Table caption={t('resellerRequests.deliveryAsks')}>
          <THead>
            <Tr>
              <Th>{t('resellerRequests.store')}</Th>
              <Th>{t('resellerRequests.order')}</Th>
              <Th>{t('resellerRequests.theyAskedFor')}</Th>
              <Th>{t('resellerRequests.why')}</Th>
              <Th>{t('resellerRequests.asked')}</Th>
              <Th>{t('resellerRequests.yourAnswer')}</Th>
            </Tr>
          </THead>
          <TBody>
            {requests.data.map((r) => (
              <RequestRow key={r.id} request={r} onReject={() => setRejecting(r)} />
            ))}
          </TBody>
        </Table>
      )}
      <RejectModal request={rejecting} onClose={() => setRejecting(null)} />
    </RsSection>
  );
}

function RequestRow({
  request,
  onReject,
}: {
  request: StoreActionRequestRow;
  onReject: () => void;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const decide = useDecideStoreAction();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function approve(): Promise<void> {
    setError(null);
    try {
      const out = await decide.mutateAsync({ requestId: request.id, approve: true });
      // Approving RUNS it. The reply is what actually happened, and the
      // store is emailed the same thing (2026-09-17).
      if (out.status !== 'EXECUTED') {
        setError(out.executionError ?? t('resellerRequests.youApprovedItBut'));
        toast.error(t('resellerRequests.approvedButItCould'));
        return;
      }
      toast.success(t('resellerRequests.approvedAndCarriedOut'));
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_ALREADY_DECIDED when somebody
      // else got there first, which is the common one on a shared queue.
      setError(verdict(err, t));
    }
  }

  // The SAME name the other two queues print (`displayName ?? name`).
  // This column read the plain `name` while its neighbours read the
  // display name, so one store appeared under two names in one stack of
  // tables and read as two different businesses.
  const storeName = request.resellerStore?.displayName ?? request.resellerStore?.name ?? '—';
  return (
    <Tr>
      <Td className="rs-strong">{storeName}</Td>
      <Td>
        <OrderCell
          number={request.order?.orderNumber ?? null}
          extra={request.order === null ? undefined : request.order.recipientName}
        />
      </Td>
      <Td className="rs-body">{askedForOf(t)[request.action]}</Td>
      <Td>
        <span className="rs-small rs-wrap">{request.reason}</span>
      </Td>
      <Td className="rs-when sk-figure">{when(request.createdAt, locale)}</Td>
      <Td>
        <AnswerCell
          busy={decide.isPending}
          onApprove={() => setConfirming(true)}
          onReject={onReject}
          error={error}
        />
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('resellerRequests.approveSAsk', {
            storeName,
            action: askedForOf(t)[request.action],
          })}
          entity={request.order?.orderNumber ?? t('resellerRequests.thisOrder')}
          entityIsIdentifier={request.order !== null}
          consequence={approveDoesOf(t)[request.action]}
          confirmLabel={t('resellerRequests.approve')}
          onConfirm={approve}
        >
          <p className="rs-muted">
            {richMessage(t('resellerRequests.why2'), { reason: request.reason })}
          </p>
        </ConfirmDialog>
      </Td>
    </Tr>
  );
}

/**
 * Rejecting takes a reason, and the server refuses without one
 * (`DELIVERY_ACTION_REASON_REQUIRED`). It is shown to the store, because
 * somebody there has to go back to a customer with it.
 */
function RejectModal({
  request,
  onClose,
}: {
  request: StoreActionRequestRow | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const decide = useDecideStoreAction();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success(t('resellerRequests.turnedDownTheStore'));
      setNote('');
      onClose();
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? t('resellerRequests.turnItDown')
          : t('resellerRequests.turnDownOn', {
              label: askedForOf(t)[request.action],
              order: request.order?.orderNumber ?? t('resellerRequests.thisOrder'),
            })
      }
      description={t('resellerRequests.theStoreReadsThis2')}
      fieldId="reject-note"
      note={note}
      setNote={setNote}
      error={error}
      pending={decide.isPending}
      onCancel={onClose}
      onClose={() => {
        setNote('');
        setError(null);
        onClose();
      }}
      onSubmit={() => void submit()}
    />
  );
}

/** What a person calls each delivery detail. */
const fieldLabelOf = (t: Translate<MessageKey>): Readonly<Record<AddressField, string>> => ({
  recipientName: t('resellerRequests.name'),
  recipientPhoneE164: t('resellerRequests.phone'),
  recipientAltPhoneE164: t('resellerRequests.secondPhone'),
  recipientEmail: t('resellerRequests.email'),
  recipientAddressLine1: t('resellerRequests.address'),
  recipientAddressLine2: t('resellerRequests.landmarkLine'),
  recipientLandmark: t('resellerRequests.landmarkOldField'),
  recipientCity: t('resellerRequests.city'),
  recipientStateProvince: t('resellerRequests.state'),
  recipientPostalCode: t('resellerRequests.pinCode'),
});

/** The same ten in the order somebody reads an address. */
const ALL_FIELDS: readonly AddressField[] = [
  'recipientName',
  'recipientPhoneE164',
  'recipientAltPhoneE164',
  'recipientEmail',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientLandmark',
  'recipientCity',
  'recipientStateProvince',
  'recipientPostalCode',
];

/**
 * What the order says NOW, per field.
 *
 * Seven of the ten, because those are the seven the queue carries — the
 * ones printed on a label. A correction to a second phone, an email or
 * the old landmark field therefore shows its new value on its own; that
 * is honest, and inventing a blank “before” would read as though the
 * order held nothing there.
 */
const CURRENT_VALUE: Partial<
  Record<AddressField, (order: NonNullable<StoreAddressChangeRow['order']>) => string>
> = {
  recipientName: (o) => o.recipientName,
  recipientPhoneE164: (o) => o.recipientPhoneE164,
  recipientAddressLine1: (o) => o.recipientAddressLine1,
  recipientAddressLine2: (o) => o.recipientAddressLine2 ?? '',
  recipientCity: (o) => o.recipientCity,
  recipientStateProvince: (o) => o.recipientStateProvince,
  recipientPostalCode: (o) => o.recipientPostalCode,
};

function AddressChangesSection(): ReactElement {
  const t = useT();
  const addresses = useStoreAddressChanges();
  const [rejecting, setRejecting] = useState<StoreAddressChangeRow | null>(null);

  return (
    <RsSection
      title={t('resellerRequests.orderAndAddressChanges')}
      note={t('resellerRequests.untilYouAnswerThe')}
      flush
    >
      {addresses.isPending ? (
        <SkeletonRows rows={2} cols={6} label={t('resellerRequests.loadingCorrections')} />
      ) : addresses.isError ? (
        <div className="rs-card__pad">
          <ErrorState
            message={verdict(addresses.error, t)}
            retry={() => void addresses.refetch()}
          />
        </div>
      ) : addresses.data.length === 0 ? (
        <EmptyState bare tone="positive" title={t('resellerRequests.noCorrectionsAreWaiting')} />
      ) : (
        <Table caption={t('resellerRequests.orderAndAddressChanges')}>
          <THead>
            <Tr>
              <Th>{t('resellerRequests.store')}</Th>
              <Th>{t('resellerRequests.order')}</Th>
              <Th>{t('resellerRequests.whatIsChanging')}</Th>
              <Th>{t('resellerRequests.whyTheySayIt')}</Th>
              <Th>{t('resellerRequests.asked')}</Th>
              <Th>{t('resellerRequests.yourAnswer')}</Th>
            </Tr>
          </THead>
          <TBody>
            {addresses.data.map((r) => (
              <AddressRow key={r.id} request={r} onReject={() => setRejecting(r)} />
            ))}
          </TBody>
        </Table>
      )}
      <RejectAddressModal request={rejecting} onClose={() => setRejecting(null)} />
    </RsSection>
  );
}

function AddressRow({
  request,
  onReject,
}: {
  request: StoreAddressChangeRow;
  onReject: () => void;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const decide = useDecideStoreAddressChange();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function approve(): Promise<void> {
    setError(null);
    try {
      const out = await decide.mutateAsync({ requestId: request.id, approve: true });
      // Saying yes and it landing are two different things: the order may
      // have been confirmed or gone into a call while this sat here. The
      // server's own words for the refusal, verbatim (FE-2).
      if (out.status === 'FAILED') {
        setError(out.failureReason ?? t('resellerRequests.youApprovedItBut2'));
        toast.error(t('resellerRequests.approvedButTheOrder'));
        return;
      }
      toast.success(t('resellerRequests.approvedTheOrderNow'));
    } catch (err) {
      // Verbatim (FE-2): ADDRESS_CHANGE_ALREADY_DECIDED when somebody
      // else answered it first, which is the common one on a shared queue.
      setError(verdict(err, t));
    }
  }

  const order = request.order;
  const storeName = request.store?.displayName ?? request.store?.name ?? '—';
  // `fields` was ABSENT from this payload for as long as the queue
  // existed (fixed 2026-09-30, API side) and reading it threw, which took
  // the whole page down — all three queues, not only this one. Defended
  // here as well as fixed there: a queue that cannot draw one row must
  // still draw the other two.
  const fields = request.fields ?? {};
  const changes = ALL_FIELDS.filter((k) => fields[k] !== undefined);
  // Everything that is NOT an address: products, quantities, the money
  // the customer pays. Named by the server, so this and the notice the
  // store gets cannot disagree about what moved.
  const otherChanges = request.otherChanges ?? [];

  // The comparison IS the decision — nobody can approve a correction they
  // cannot check against what the parcel says now. The confirmation shows
  // the same list, so the thing being approved is on screen at the moment
  // of approving.
  const changeList = (
    <ul className="rs-changes">
      {changes.map((k) => {
        const now = order === null || order === undefined ? undefined : CURRENT_VALUE[k]?.(order);
        return (
          <li key={k}>
            <span className="rs-changes__field">{fieldLabelOf(t)[k]}: </span>
            {now === undefined || now === null || now === '' ? null : (
              <span className="rs-changes__was">{now} → </span>
            )}
            <span className="rs-changes__now">{fields[k] ?? ''}</span>
          </li>
        );
      })}
      {/*
        A change that moves only the contents or the money listed
        NOTHING — an empty cell above an Approve button, which is a
        change somebody would be agreeing to without being able to see
        it. No before-and-after here on purpose: the proposal is a patch
        over items and figures, and inventing a one-line "was" for it
        would be a summary we made up.
      */}
      {otherChanges.map((label) => (
        <li key={label}>
          <span className="rs-changes__field">{t('resellerRequests.alsoChanging')}</span>
          <span className="rs-changes__now">{label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <Tr>
      <Td className="rs-strong">{storeName}</Td>
      <Td>
        <OrderCell number={order?.orderNumber ?? null} status={order?.status} />
      </Td>
      <Td>{changeList}</Td>
      <Td>
        <span className="rs-small rs-wrap">{request.reason}</span>
      </Td>
      <Td className="rs-when sk-figure">{when(request.createdAt, locale)}</Td>
      <Td>
        <AnswerCell
          busy={decide.isPending}
          onApprove={() => setConfirming(true)}
          onReject={onReject}
          error={error}
        />
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('resellerRequests.approveSChange', { storeName })}
          entity={order?.orderNumber ?? t('resellerRequests.thisOrder')}
          entityIsIdentifier={order !== null}
          consequence={t('resellerRequests.approvingWritesTheNew')}
          confirmLabel={t('resellerRequests.approve')}
          onConfirm={approve}
        >
          {changeList}
        </ConfirmDialog>
      </Td>
    </Tr>
  );
}

/**
 * Turning a correction down takes a reason, and the server refuses
 * without one (`ADDRESS_CHANGE_REASON_REQUIRED`). The store reads it —
 * they still have a parcel going somewhere they believe is wrong, and
 * they have to decide what to tell their customer.
 */
function RejectAddressModal({
  request,
  onClose,
}: {
  request: StoreAddressChangeRow | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const decide = useDecideStoreAddressChange();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success(t('resellerRequests.turnedDownTheStore'));
      setNote('');
      onClose();
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? t('resellerRequests.turnDownTheCorrection')
          : t('resellerRequests.leaveGoingToAddress', {
              order: request.order?.orderNumber ?? t('resellerRequests.thisOrder'),
            })
      }
      description={t('resellerRequests.theStoreReadsThis3')}
      fieldId="reject-address-note"
      note={note}
      setNote={setNote}
      error={error}
      pending={decide.isPending}
      onCancel={onClose}
      onClose={() => {
        setNote('');
        setError(null);
        onClose();
      }}
      onSubmit={() => void submit()}
    />
  );
}
