'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
} from '@skydrop/ui/components';
import { useCreateProposal, useProposals, useWithdrawProposal } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const PAGE_SIZE = 25;

/**
 * Ask for a category that does not exist yet.
 *
 * Categories are shared across every seller — they carry the GST rate,
 * the HS code and the packaging defaults that products inherit — so you
 * cannot simply create one. You propose it, and somebody at Skydrop
 * either creates it for everyone or points you at the category you
 * should have used.
 *
 * A proposal you no longer need can be withdrawn while it is pending;
 * that is politer than leaving it in someone's queue.
 */
export function ProposalsIndex(): ReactElement {
  const [page, setPage] = useState(1);
  const [proposing, setProposing] = useState(false);
  const list = useProposals({ page, pageSize: PAGE_SIZE });
  const withdraw = useWithdrawProposal();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Category requests"
        subtitle="Categories are shared by every seller, so a new one is reviewed before it is created."
        action={<Button onClick={() => setProposing(true)}>Request a category</Button>}
      />

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={4} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="If nothing in the category list fits what you sell, ask for one — say what it is and why the existing ones do not work."
            action={<Button onClick={() => setProposing(true)}>Request a category</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Requested</Th>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Answer</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((p) => (
                  <Tr key={p.id}>
                    <Td>{new Date(p.createdAt).toLocaleDateString('en-IN')}</Td>
                    <Td>
                      <div>{p.proposedName}</div>
                      <code className="text-text-faint text-xs">{p.proposedSlug}</code>
                    </Td>
                    <Td>
                      <StatusBadge kind={proposalKind(p.status)} label={p.status.toLowerCase()} />
                    </Td>
                    <Td>
                      {p.decisionNote ?? (
                        <span className="text-text-faint">
                          {p.status === 'PENDING' ? 'Waiting for review' : '—'}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {p.status === 'PENDING' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={withdraw.isPending}
                          onClick={() => withdraw.mutate({ id: p.id })}
                        >
                          Withdraw
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      {withdraw.error !== null && <ErrorNote message={serverVerdict(withdraw.error)} />}

      <ProposeCategory open={proposing} onClose={() => setProposing(false)} />
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

/** Slug the way the API wants it, so the field is not a guessing game. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ProposeCategory({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const create = useCreateProposal();
  const [name, setName] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState('');
  const [rationale, setRationale] = useState('');

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function close(): void {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setRationale('');
    create.reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Request a category"
      description="Someone at Skydrop reviews this. If an existing category fits, they will tell you which."
    >
      <FormField label="Category name" htmlFor="cp-name">
        <Input
          id="cp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Premium apparel"
        />
      </FormField>

      <FormField
        label="Slug"
        htmlFor="cp-slug"
        hint="Lowercase, hyphenated. Filled in from the name — edit if you want something different."
      >
        <Input
          id="cp-slug"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
      </FormField>

      <FormField
        label="Why this one"
        htmlFor="cp-why"
        hint="What you sell, and which existing category you tried first. This is what the decision is made on."
      >
        <Textarea
          id="cp-why"
          rows={4}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="We sell heavyweight winter coats. Apparel › Outerwear has a 12% GST default but these are taxed at 18%."
        />
      </FormField>

      {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={
            name.trim() === '' ||
            effectiveSlug === '' ||
            rationale.trim() === '' ||
            create.isPending
          }
          onClick={() =>
            create.mutate(
              {
                proposedName: name.trim(),
                proposedSlug: effectiveSlug,
                rationale: rationale.trim(),
              },
              { onSuccess: close },
            )
          }
        >
          {create.isPending ? 'Sending…' : 'Send request'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
