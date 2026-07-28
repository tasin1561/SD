'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Textarea,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import {
  useApproveProposal,
  useProposalsList,
  useRejectProposal,
  type CategoryProposalView,
} from '@/lib/proposal-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const PAGE_SIZE = 25;

/**
 * Seller category proposals.
 *
 * A seller who cannot find a category for what they sell proposes one.
 * Until this screen existed, nothing could act on that: the seller
 * endpoint wrote PENDING rows and no interface anywhere read them, so
 * every proposal ever made was still sitting there unanswered.
 *
 * Approving is a CREATE, not a flag — it makes a real category that
 * every seller then sees and files products under. So the approval form
 * asks for the defaults that category will carry (GST rate, packaging,
 * HS code), because those are inherited by every variant beneath it and
 * are far more annoying to correct later than to set now.
 */
export function ProposalsIndex(): ReactElement {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CategoryProposalView | null>(null);

  const list = useProposalsList({
    ...(status === '' ? {} : { status }),
    page,
    pageSize: PAGE_SIZE,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pending = items.filter((p) => p.status === 'PENDING');

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Category proposals"
        subtitle="Sellers asking for a category that does not exist yet. Approving one creates it for everybody."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Shown" value={<Num value={items.length} />} />
        <Stat
          label="Awaiting a decision"
          value={<Num value={pending.length} />}
          tone={pending.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Oldest waiting"
          hint="A seller cannot list the product until this is answered"
          value={
            pending.length === 0 ? (
              '—'
            ) : (
              <span className="text-sm">
                {new Date(
                  Math.min(...pending.map((p) => new Date(p.createdAt).getTime())),
                ).toLocaleDateString('en-IN')}
              </span>
            )
          }
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="prop-status">
          Status
        </label>
        <Select
          id="prop-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={5} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={status === 'PENDING' ? 'Nothing to decide' : 'No proposals'}
            description="Sellers propose a category from their catalog when nothing existing fits what they are listing."
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Proposed</Th>
                  <Th>Slug</Th>
                  <Th>Seller</Th>
                  <Th>Raised</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((p) => (
                  <Tr key={p.id}>
                    <Td>{p.proposedName}</Td>
                    <Td>
                      <code className="text-text-muted text-xs">{p.proposedSlug}</code>
                    </Td>
                    <Td>
                      <Ident value={p.sellerId} />
                    </Td>
                    <Td>{new Date(p.createdAt).toLocaleDateString('en-IN')}</Td>
                    <Td>
                      <StatusBadge kind={proposalKind(p.status)} label={p.status.toLowerCase()} />
                    </Td>
                    <Td align="right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(p)}>
                        {p.status === 'PENDING' ? 'Review' : 'View'}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <ProposalReview proposal={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function proposalKind(status: string): 'pending' | 'delivered' | 'failed' | 'cancelled' {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
      return 'delivered';
    case 'REJECTED':
      return 'failed';
    default:
      return 'cancelled';
  }
}

function ProposalReview({
  proposal,
  onClose,
}: {
  proposal: CategoryProposalView | null;
  onClose: () => void;
}): ReactElement {
  const approve = useApproveProposal();
  const reject = useRejectProposal();
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view');
  const [note, setNote] = useState('');
  const [gstRate, setGstRate] = useState('');
  const [hsCode, setHsCode] = useState('');

  const decided = proposal !== null && proposal.status !== 'PENDING';
  const error = approve.error ?? reject.error;

  function close(): void {
    setMode('view');
    setNote('');
    setGstRate('');
    setHsCode('');
    approve.reset();
    reject.reset();
    onClose();
  }

  return (
    <Modal
      open={proposal !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={proposal?.proposedName ?? 'Proposal'}
      description={
        proposal === null ? undefined : (
          <span className="flex items-center gap-2">
            <StatusBadge
              kind={proposalKind(proposal.status)}
              label={proposal.status.toLowerCase()}
            />
            <span className="text-text-faint">
              raised {new Date(proposal.createdAt).toLocaleString()}
            </span>
          </span>
        )
      }
    >
      {proposal !== null && (
        <>
          <DescriptionList
            items={[
              { label: 'Proposed name', value: proposal.proposedName },
              { label: 'Slug', value: <code className="text-xs">{proposal.proposedSlug}</code> },
              {
                label: 'Nests under',
                value:
                  proposal.proposedParentId === null ? (
                    'Top level'
                  ) : (
                    <Ident value={proposal.proposedParentId} />
                  ),
              },
              { label: 'Seller', value: <Ident value={proposal.sellerId} /> },
              ...(proposal.resultingCategoryId === null
                ? []
                : [
                    {
                      label: 'Created category',
                      value: <Ident value={proposal.resultingCategoryId} />,
                    },
                  ]),
            ]}
          />

          <Section title="Why they asked">
            <p className="text-text-muted text-sm">{proposal.rationale}</p>
          </Section>

          {proposal.decisionNote !== null && (
            <Section title="Decision note">
              <p className="text-text-muted text-sm">{proposal.decisionNote}</p>
            </Section>
          )}

          {mode === 'approve' && (
            <Section
              title="Defaults for the new category"
              subtitle="Inherited by every product and variant filed under it. Leave blank to inherit from the parent or the system default — far easier to set now than to correct across a catalog later."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Default GST rate (%)"
                  htmlFor="pr-gst"
                  hint="Whole percent: 5, 12, 18, 28."
                >
                  <Input
                    id="pr-gst"
                    type="number"
                    min={0}
                    max={100}
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                    placeholder="Leave blank for the system default"
                  />
                </FormField>
                <FormField label="Default HS code" htmlFor="pr-hs" hint="Customs classification.">
                  <Input id="pr-hs" value={hsCode} onChange={(e) => setHsCode(e.target.value)} />
                </FormField>
              </div>
              <FormField label="Note to the seller" htmlFor="pr-note" hint="Optional.">
                <Textarea
                  id="pr-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormField>
            </Section>
          )}

          {mode === 'reject' && (
            <Section
              title="Why you are rejecting"
              subtitle="The seller sees this. Point at the category they should use instead if there is one."
            >
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. This fits under Apparel › Outerwear — file it there."
              />
            </Section>
          )}

          {error !== null && error !== undefined && <ErrorNote message={serverVerdict(error)} />}
        </>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Close
        </Button>
        {proposal !== null && !decided && mode === 'view' && (
          <>
            <Button variant="destructive" size="md" onClick={() => setMode('reject')}>
              Reject
            </Button>
            <Button size="md" onClick={() => setMode('approve')}>
              Approve…
            </Button>
          </>
        )}
        {proposal !== null && !decided && mode === 'approve' && (
          <Button
            size="md"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate(
                {
                  id: proposal.id,
                  body: {
                    ...(note.trim() === '' ? {} : { decisionNote: note.trim() }),
                    ...(gstRate === '' ? {} : { defaultGstRate: Number(gstRate) }),
                    ...(hsCode.trim() === '' ? {} : { defaultHsCode: hsCode.trim() }),
                  },
                },
                { onSuccess: close },
              )
            }
          >
            {approve.isPending ? 'Creating…' : 'Approve — creates the category'}
          </Button>
        )}
        {proposal !== null && !decided && mode === 'reject' && (
          <Button
            variant="destructive"
            size="md"
            disabled={note.trim().length === 0 || reject.isPending}
            onClick={() =>
              reject.mutate({ id: proposal.id, decisionNote: note.trim() }, { onSuccess: close })
            }
          >
            {reject.isPending ? 'Rejecting…' : 'Confirm reject'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
