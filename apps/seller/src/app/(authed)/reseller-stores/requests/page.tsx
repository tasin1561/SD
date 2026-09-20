'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { MapPin, MessageSquareWarning, Truck } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  OrderStatusBadge,
  PageHeader,
  SectionBand,
  Stat,
  StripFact,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
 * 2026-09-16 — the one queue for everything your reseller stores are
 * waiting on: what they have asked to DO to a parcel, and what they have
 * asked to CHANGE on one.
 *
 * Only the ones your own policy marked “ask me first” stop here; the ones
 * you let through have already run. Nothing happens on any of them until
 * you answer, and the store has a customer waiting for that answer —
 * which is why a rejection needs a reason and the store is told either
 * way.
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
  // Asked here only to decide whether BOTH queues are empty; the two
  // sections ask again and read the same cache entry, so this costs no
  // extra request.
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
      breadcrumb={
        <Crumbs
          items={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Waiting on you' }]}
          Link={Link}
        />
      }
      title="Waiting on you"
      subtitle="What your Reseller stores have asked Seller staff to approve. Until you answer, nothing happens — and a request nobody answers closes after a few days and the store is told."
      meta={
        !counted ? undefined : (
          <MetaChip tone={total > 0 ? 'warn' : 'good'} dot={total > 0}>
            {total === 0 ? 'Nothing waiting' : `${total} waiting`}
          </MetaChip>
        )
      }
      action={
        <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
          All reseller stores →
        </Link>
      }
    />
  );

  /*
    One tile per QUEUE, each counting the rows its own section renders.
    A single "waiting" number would not say which desk the work is on,
    and the three want different answers: a cancel is a decision, an
    order change is a comparison, a delivery ask spends money.
  */
  const tiles = counted ? (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat
        label="Cancels, call questions, issues"
        icon={<MessageSquareWarning size={13} aria-hidden />}
        value={orderCount ?? 0}
        unit={orderCount === 1 ? 'request' : 'requests'}
        tone={(orderCount ?? 0) > 0 ? 'warn' : 'neutral'}
        hint="Approving runs it exactly as if the store had done it itself."
      />
      <Stat
        label="Delivery asks"
        icon={<Truck size={13} aria-hidden />}
        value={actionCount ?? 0}
        unit={actionCount === 1 ? 'ask' : 'asks'}
        tone={(actionCount ?? 0) > 0 ? 'warn' : 'neutral'}
        hint="Call again, deliver again, or send the parcel back."
      />
      <Stat
        label="Order and address changes"
        icon={<MapPin size={13} aria-hidden />}
        value={addressCount ?? 0}
        unit={addressCount === 1 ? 'change' : 'changes'}
        tone={(addressCount ?? 0) > 0 ? 'warn' : 'neutral'}
        hint="Until you answer, the parcel keeps the details it has."
      />
    </div>
  ) : null;

  // Both still loading: one skeleton rather than two stacked.
  if (requests.isPending && addresses.isPending && orderRequests.isPending) {
    return (
      <div>
        {header}
        <LoadingState label="Loading what your stores are waiting on" rows={4} />
      </div>
    );
  }

  // An empty queue is the ordinary state, and it reads far better as one
  // sentence than as two empty tables.
  const allEmpty =
    requests.data !== undefined &&
    requests.data.length === 0 &&
    addresses.data !== undefined &&
    addresses.data.length === 0 &&
    orderRequests.data !== undefined &&
    orderRequests.data.length === 0;

  return (
    <div>
      {header}
      {tiles}
      {allEmpty ? (
        <EmptyState
          title="Nothing is waiting"
          description="When a reseller store asks for something you chose to approve yourself, it appears here. Anything you let them do on their own never stops here at all."
          action={
            <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
              Change what your stores can do
            </Link>
          }
        />
      ) : (
        <>
          <OrderRequestsSection />
          <ActionRequestsSection />
          <AddressChangesSection />
          {counted && (
            <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
              <StripFact label="Waiting" value={total} tone={total > 0 ? 'warn' : 'good'} />
              <StripFact label="Cancels & issues" value={orderCount ?? 0} />
              <StripFact label="Delivery asks" value={actionCount ?? 0} />
              <StripFact label="Changes" value={addressCount ?? 0} />
            </div>
          )}
        </>
      )}
    </div>
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
    <>
      <SectionBand
        index="01"
        title="Cancels, call questions and issues"
        note="Call an order off, answer whether to keep calling, or raise an issue with Skydrop."
      />
      <BandBody flush className="mb-4">
        {rows.isPending ? (
          <div className="p-3">
            <LoadingState label="Loading requests" rows={2} />
          </div>
        ) : rows.isError ? (
          <div className="p-3">
            <ErrorState message={serverVerdict(rows.error)} retry={() => void rows.refetch()} />
          </div>
        ) : rows.data.length === 0 ? (
          <EmptyState bare title="Nothing to answer here" />
        ) : (
          <Table>
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
      </BandBody>
      <RejectOrderRequestModal request={rejecting} onClose={() => setRejecting(null)} />
    </>
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
  return (
    <Tr>
      <Td>{request.store?.displayName ?? request.store?.name ?? '—'}</Td>
      <Td>
        <span className="font-mono text-xs">{order?.orderNumber ?? '—'}</span>
        {order === null ? null : (
          <div className="mt-1">
            <OrderStatusBadge status={order.status} />
          </div>
        )}
      </Td>
      <Td className="max-w-xs">
        <span className="text-text-body text-sm">{request.label}</span>
      </Td>
      <Td className="max-w-xs">
        <span className="text-text-body text-xs">{request.note ?? '—'}</span>
      </Td>
      <Td className="text-text-muted text-xs">{when(request.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => void approve()}
          >
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={decide.isPending} onClick={onReject}>
            Reject
          </Button>
        </div>
        {error !== null ? (
          <p role="alert" className="text-critical mt-1 text-xs">
            {error}
          </p>
        ) : null}
      </Td>
    </Tr>
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
    <Modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote('');
          setError(null);
          onClose();
        }
      }}
      title={
        request === null
          ? 'Turn it down'
          : `Turn down “${request.label}” on ${request.order?.orderNumber ?? 'this order'}?`
      }
      description="The store reads this, and nothing is done. Say why."
    >
      <div className="space-y-4">
        <FormField label="Your reason" htmlFor="reject-order-request-note" required>
          <Textarea
            id="reject-order-request-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            disabled={note.trim() === '' || decide.isPending}
            onClick={() => void submit()}
          >
            {decide.isPending ? 'Sending…' : 'Turn it down'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

function ActionRequestsSection(): ReactElement {
  const requests = useStoreActionRequests();
  const [rejecting, setRejecting] = useState<StoreActionRequestRow | null>(null);

  return (
    <>
      <SectionBand
        index="02"
        title="Delivery asks"
        note="Call the customer again, try delivering again, or send the parcel back."
      />
      <BandBody flush className="mb-4">
        {requests.isPending ? (
          <div className="p-3">
            <LoadingState label="Loading asks" rows={2} />
          </div>
        ) : requests.isError ? (
          <div className="p-3">
            <ErrorState
              message={serverVerdict(requests.error)}
              retry={() => void requests.refetch()}
            />
          </div>
        ) : requests.data.length === 0 ? (
          <EmptyState bare title="Nothing to answer here" />
        ) : (
          <Table>
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
      </BandBody>
      <RejectModal request={rejecting} onClose={() => setRejecting(null)} />
    </>
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

  return (
    <Tr>
      <Td>{request.resellerStore?.name ?? '—'}</Td>
      <Td>
        <span className="font-mono text-xs">{request.order?.orderNumber ?? '—'}</span>
        {request.order === null ? null : (
          <div className="text-text-muted text-xs">{request.order.recipientName}</div>
        )}
      </Td>
      <Td>{ASKED_FOR[request.action]}</Td>
      <Td className="max-w-xs">
        <span className="text-text-body text-xs">{request.reason}</span>
      </Td>
      <Td className="text-text-muted text-xs">{when(request.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => void approve()}
          >
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={decide.isPending} onClick={onReject}>
            Reject
          </Button>
        </div>
        {error !== null ? (
          <p role="alert" className="text-critical mt-1 text-xs">
            {error}
          </p>
        ) : null}
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
    <Modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote('');
          setError(null);
          onClose();
        }
      }}
      title={
        request === null
          ? 'Turn it down'
          : `Turn down “${ASKED_FOR[request.action]}” on ${request.order?.orderNumber ?? 'this order'}?`
      }
      description="The store reads this. They have a customer waiting on the answer, so say why."
    >
      <div className="space-y-4">
        <FormField label="Your reason" htmlFor="reject-note" required>
          <Textarea
            id="reject-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            disabled={note.trim() === '' || decide.isPending}
            onClick={() => void submit()}
          >
            {decide.isPending ? 'Sending…' : 'Turn it down'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
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
    <>
      <SectionBand
        index="03"
        title="Order and address changes"
        note="Until you answer, the parcel keeps the details it has."
      />
      <BandBody flush>
        {addresses.isPending ? (
          <div className="p-3">
            <LoadingState label="Loading corrections" rows={2} />
          </div>
        ) : addresses.isError ? (
          <div className="p-3">
            <ErrorState
              message={serverVerdict(addresses.error)}
              retry={() => void addresses.refetch()}
            />
          </div>
        ) : addresses.data.length === 0 ? (
          <EmptyState bare title="No corrections are waiting" />
        ) : (
          <Table>
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
      </BandBody>
      <RejectAddressModal request={rejecting} onClose={() => setRejecting(null)} />
    </>
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

  return (
    <Tr>
      <Td>{request.store?.displayName ?? request.store?.name ?? '—'}</Td>
      <Td>
        <span className="font-mono text-xs">{order?.orderNumber ?? '—'}</span>
        {order === null ? null : (
          <div className="mt-1">
            <OrderStatusBadge status={order.status} />
          </div>
        )}
      </Td>
      {/* The comparison IS the decision — nobody can approve a correction
          they cannot check against what the parcel says now. */}
      <Td>
        <ul className="space-y-1">
          {ALL_FIELDS.filter((k) => request.fields[k] !== undefined).map((k) => {
            const now = order === null ? undefined : CURRENT_VALUE[k]?.(order);
            return (
              <li key={k} className="text-xs">
                <span className="text-text-muted">{FIELD_LABEL[k]}: </span>
                {now === undefined || now === '' ? null : (
                  <span className="text-text-faint">{now} → </span>
                )}
                <span className="text-text-body">{request.fields[k] ?? ''}</span>
              </li>
            );
          })}
        </ul>
      </Td>
      <Td className="max-w-xs">
        <span className="text-text-body text-xs">{request.reason}</span>
      </Td>
      <Td className="text-text-muted text-xs">{when(request.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => void approve()}
          >
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={decide.isPending} onClick={onReject}>
            Reject
          </Button>
        </div>
        {error !== null ? (
          <p role="alert" className="text-critical mt-1 text-xs">
            {error}
          </p>
        ) : null}
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
    <Modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote('');
          setError(null);
          onClose();
        }
      }}
      title={
        request === null
          ? 'Turn down the correction'
          : `Leave ${request.order?.orderNumber ?? 'this order'} going to the address it has?`
      }
      description="The store reads this. The parcel keeps its current address, so say why you are leaving it."
    >
      <div className="space-y-4">
        <FormField label="Your reason" htmlFor="reject-address-note" required>
          <Textarea
            id="reject-address-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            disabled={note.trim() === '' || decide.isPending}
            onClick={() => void submit()}
          >
            {decide.isPending ? 'Sending…' : 'Turn it down'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
