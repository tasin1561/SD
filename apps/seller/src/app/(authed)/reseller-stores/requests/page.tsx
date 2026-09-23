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
import { serverVerdict } from '@/lib/server-verdict';
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

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** What the store asked for, in the seller's words rather than an enum. */
const ASKED_FOR: Record<StoreActionRequestRow['action'], string> = {
  RECALL: 'Call the customer again',
  REATTEMPT: 'Try delivering it again',
  RTO: 'Send the parcel back',
};

/**
 * What approving a delivery ask DOES, per ask — the same words the
 * store's "What they can do" screen uses for a direct action. Approving
 * runs exactly that, so the confirmation says it before it happens.
 */
const APPROVE_DOES: Record<StoreActionRequestRow['action'], string> = {
  RECALL:
    'Approving runs it now: the call is queued with our call centre. The store is told either way.',
  REATTEMPT:
    'Approving runs it now: a ticket opens and Skydrop admin passes the request to the courier. The store is told either way.',
  RTO: 'Approving runs it now: the courier is asked to return the parcel. The store is told either way.',
};

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
        { label: 'Seller console' },
        { label: 'Reselling' },
        { label: 'Waiting on you' },
      ]}
      Link={Link}
      title="Waiting on you"
      subtitle="What your Reseller stores have asked Seller staff to approve. Until you answer, nothing happens — and a request nobody answers closes after a few days and the store is told."
      meta={
        !counted ? undefined : (
          <RsFacts>
            <RsFact tone={total > 0 ? 'warn' : 'good'} dot={total > 0}>
              {total === 0 ? 'Nothing waiting' : `${total} waiting`}
            </RsFact>
          </RsFacts>
        )
      }
      action={<RsLink href="/reseller-stores">All reseller stores</RsLink>}
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
        label="Cancels, call questions, issues"
        icon={<MessageSquareWarning size={14} />}
        value={orderCount ?? 0}
        unit={orderCount === 1 ? 'request' : 'requests'}
        tone={(orderCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint="Approving runs it exactly as if the store had done it itself."
      />
      <KpiCard
        label="Delivery asks"
        icon={<Truck size={14} />}
        value={actionCount ?? 0}
        unit={actionCount === 1 ? 'ask' : 'asks'}
        tone={(actionCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint="Call again, deliver again, or send the parcel back."
      />
      <KpiCard
        label="Order and address changes"
        icon={<MapPin size={14} />}
        value={addressCount ?? 0}
        unit={addressCount === 1 ? 'change' : 'changes'}
        tone={(addressCount ?? 0) > 0 ? 'pending' : 'neutral'}
        hint="Until you answer, the parcel keeps the details it has."
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
        <SkeletonRows rows={4} cols={6} label="Loading what your stores are waiting on" />
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
          title="Nothing is waiting"
          description="When a reseller store asks for something you chose to approve yourself, it appears here. Anything you let them do on their own never stops here at all."
          action={<RsLink href="/reseller-stores">Change what your stores can do</RsLink>}
        />
      ) : (
        <>
          <OrderRequestsSection />
          <ActionRequestsSection />
          <AddressChangesSection />
          {counted && (
            <RsStrip>
              <RsStripFact label="Waiting" value={total} tone={total > 0 ? 'warn' : 'good'} />
              <RsStripFact label="Cancels & issues" value={orderCount ?? 0} />
              <RsStripFact label="Delivery asks" value={actionCount ?? 0} />
              <RsStripFact label="Changes" value={addressCount ?? 0} />
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
          Approve
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<X size={13} />}
          disabled={busy}
          onClick={onReject}
        >
          Reject
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
  return (
    <>
      <span className="sk-ident">{number ?? '—'}</span>
      {status !== undefined ? (
        <div className="rs-block">
          <StatusChip kind={orderStatusKind(status)} label={statusLabel(status)} size="sm" />
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
  const rows = useStoreOrderRequests();
  const [rejecting, setRejecting] = useState<StoreOrderRequestRow | null>(null);

  return (
    <RsSection
      title="Cancels, call questions and issues"
      note="Call an order off, answer whether to keep calling, or raise an issue with Skydrop."
      flush
    >
      {rows.isPending ? (
        <SkeletonRows rows={2} cols={6} label="Loading requests" />
      ) : rows.isError ? (
        <div className="rs-card__pad">
          <ErrorState message={serverVerdict(rows.error)} retry={() => void rows.refetch()} />
        </div>
      ) : rows.data.length === 0 ? (
        <EmptyState bare tone="positive" title="Nothing to answer here" />
      ) : (
        <Table caption="Cancels, call questions and issues">
          <THead>
            <Tr>
              <Th>Store</Th>
              <Th>Order</Th>
              <Th>They asked to</Th>
              <Th>What they said</Th>
              <Th>Asked</Th>
              <Th>Your answer</Th>
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
        setError(
          out.failureReason ??
            'You approved it, but it could not be carried out. The store has been told.',
        );
        toast.error('Approved, but it could not be carried out.');
        return;
      }
      toast.success('Approved and carried out. The store has been told.');
    } catch (err) {
      // Verbatim (FE-2): STORE_REQUEST_ALREADY_DECIDED when somebody else
      // answered it first.
      setError(serverVerdict(err));
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
      <Td className="rs-when sk-figure">{when(request.createdAt)}</Td>
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
          title={`Approve ${storeName}’s request?`}
          entity={order?.orderNumber ?? 'this order'}
          entityIsIdentifier={order !== null}
          consequence="Approving runs it exactly as if the store had done it itself. The store is told either way."
          confirmLabel="Approve"
          onConfirm={approve}
        >
          <p className="rs-muted">They asked to: {request.label}</p>
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
            Cancel
          </Button>
          <AsyncButton
            variant="destructive"
            size="md"
            disabled={note.trim() === ''}
            state={pendingPhase(pending)}
            labels={{ idle: 'Turn it down', busy: 'Sending…' }}
            onClick={onSubmit}
          />
        </DialogFooter>
      }
    >
      <div className="rs-form">
        <TextArea
          id={fieldId}
          label="Your reason"
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
  const decide = useDecideStoreOrderRequest();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success('Turned down. The store has been sent your reason.');
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? 'Turn it down'
          : `Turn down “${request.label}” on ${request.order?.orderNumber ?? 'this order'}?`
      }
      description="The store reads this, and nothing is done. Say why."
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
  const requests = useStoreActionRequests();
  const [rejecting, setRejecting] = useState<StoreActionRequestRow | null>(null);

  return (
    <RsSection
      title="Delivery asks"
      note="Call the customer again, try delivering again, or send the parcel back."
      flush
    >
      {requests.isPending ? (
        <SkeletonRows rows={2} cols={6} label="Loading asks" />
      ) : requests.isError ? (
        <div className="rs-card__pad">
          <ErrorState
            message={serverVerdict(requests.error)}
            retry={() => void requests.refetch()}
          />
        </div>
      ) : requests.data.length === 0 ? (
        <EmptyState bare tone="positive" title="Nothing to answer here" />
      ) : (
        <Table caption="Delivery asks">
          <THead>
            <Tr>
              <Th>Store</Th>
              <Th>Order</Th>
              <Th>They asked for</Th>
              <Th>Why</Th>
              <Th>Asked</Th>
              <Th>Your answer</Th>
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
        setError(
          out.executionError ??
            'You approved it, but it could not be carried out. The store has been told.',
        );
        toast.error('Approved, but it could not be carried out.');
        return;
      }
      toast.success('Approved and carried out. The store has been told.');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_ALREADY_DECIDED when somebody
      // else got there first, which is the common one on a shared queue.
      setError(serverVerdict(err));
    }
  }

  const storeName = request.resellerStore?.name ?? '—';
  return (
    <Tr>
      <Td className="rs-strong">{storeName}</Td>
      <Td>
        <OrderCell
          number={request.order?.orderNumber ?? null}
          extra={request.order === null ? undefined : request.order.recipientName}
        />
      </Td>
      <Td className="rs-body">{ASKED_FOR[request.action]}</Td>
      <Td>
        <span className="rs-small rs-wrap">{request.reason}</span>
      </Td>
      <Td className="rs-when sk-figure">{when(request.createdAt)}</Td>
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
          title={`Approve ${storeName}’s ask: ${ASKED_FOR[request.action]}?`}
          entity={request.order?.orderNumber ?? 'this order'}
          entityIsIdentifier={request.order !== null}
          consequence={APPROVE_DOES[request.action]}
          confirmLabel="Approve"
          onConfirm={approve}
        >
          <p className="rs-muted">Why: {request.reason}</p>
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
  const decide = useDecideStoreAction();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success('Turned down. The store has been sent your reason.');
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? 'Turn it down'
          : `Turn down “${ASKED_FOR[request.action]}” on ${request.order?.orderNumber ?? 'this order'}?`
      }
      description="The store reads this. They have a customer waiting on the answer, so say why."
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
const FIELD_LABEL: Readonly<Record<AddressField, string>> = {
  recipientName: 'Name',
  recipientPhoneE164: 'Phone',
  recipientAltPhoneE164: 'Second phone',
  recipientEmail: 'Email',
  recipientAddressLine1: 'Address',
  recipientAddressLine2: 'Landmark line',
  recipientLandmark: 'Landmark (old field)',
  recipientCity: 'City',
  recipientStateProvince: 'State',
  recipientPostalCode: 'PIN code',
};

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
  recipientAddressLine2: (o) => o.recipientAddressLine2,
  recipientCity: (o) => o.recipientCity,
  recipientStateProvince: (o) => o.recipientStateProvince,
  recipientPostalCode: (o) => o.recipientPostalCode,
};

function AddressChangesSection(): ReactElement {
  const addresses = useStoreAddressChanges();
  const [rejecting, setRejecting] = useState<StoreAddressChangeRow | null>(null);

  return (
    <RsSection
      title="Order and address changes"
      note="Until you answer, the parcel keeps the details it has."
      flush
    >
      {addresses.isPending ? (
        <SkeletonRows rows={2} cols={6} label="Loading corrections" />
      ) : addresses.isError ? (
        <div className="rs-card__pad">
          <ErrorState
            message={serverVerdict(addresses.error)}
            retry={() => void addresses.refetch()}
          />
        </div>
      ) : addresses.data.length === 0 ? (
        <EmptyState bare tone="positive" title="No corrections are waiting" />
      ) : (
        <Table caption="Order and address changes">
          <THead>
            <Tr>
              <Th>Store</Th>
              <Th>Order</Th>
              <Th>What is changing</Th>
              <Th>Why they say it is wrong</Th>
              <Th>Asked</Th>
              <Th>Your answer</Th>
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
        setError(
          out.failureReason ??
            'You approved it, but the order had already moved on and the details were not changed.',
        );
        toast.error('Approved, but the order could not be changed.');
        return;
      }
      toast.success(
        'Approved — the order now carries the new details, and the store has been told.',
      );
    } catch (err) {
      // Verbatim (FE-2): ADDRESS_CHANGE_ALREADY_DECIDED when somebody
      // else answered it first, which is the common one on a shared queue.
      setError(serverVerdict(err));
    }
  }

  const order = request.order;
  const storeName = request.store?.displayName ?? request.store?.name ?? '—';
  const changes = ALL_FIELDS.filter((k) => request.fields[k] !== undefined);

  // The comparison IS the decision — nobody can approve a correction they
  // cannot check against what the parcel says now. The confirmation shows
  // the same list, so the thing being approved is on screen at the moment
  // of approving.
  const changeList = (
    <ul className="rs-changes">
      {changes.map((k) => {
        const now = order === null ? undefined : CURRENT_VALUE[k]?.(order);
        return (
          <li key={k}>
            <span className="rs-changes__field">{FIELD_LABEL[k]}: </span>
            {now === undefined || now === '' ? null : (
              <span className="rs-changes__was">{now} → </span>
            )}
            <span className="rs-changes__now">{request.fields[k] ?? ''}</span>
          </li>
        );
      })}
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
      <Td className="rs-when sk-figure">{when(request.createdAt)}</Td>
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
          title={`Approve ${storeName}’s change?`}
          entity={order?.orderNumber ?? 'this order'}
          entityIsIdentifier={order !== null}
          consequence="Approving writes the new details onto the order, if it still can. The store is told either way."
          confirmLabel="Approve"
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
  const decide = useDecideStoreAddressChange();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success('Turned down. The store has been sent your reason.');
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <ReasonDialog
      open={request !== null}
      title={
        request === null
          ? 'Turn down the correction'
          : `Leave ${request.order?.orderNumber ?? 'this order'} going to the address it has?`
      }
      description="The store reads this. The parcel keeps its current address, so say why you are leaving it."
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
