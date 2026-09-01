'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useCreateTicket, useIssueCategories } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const MIN_DESCRIPTION = 3;
/** Their form's own limit. Matching it means nothing is truncated on the way. */
const MAX_DESCRIPTION = 300;

/**
 * Raise an issue: pick the problem, then describe it.
 *
 * The categories are the COURIER'S OWN, so the seller answers the same
 * question Delhivery would have asked them directly. That matters twice
 * over — ops can triage a queue without reading every sentence first,
 * and the category travels with the escalation instead of being guessed
 * later by somebody reading the seller's words.
 *
 * A subcategory step appears only when the chosen category HAS any.
 * Several of Delhivery's go straight to the description, and inventing
 * a sub-choice for those would ask the seller a question the courier
 * never asks.
 *
 * The subject is DERIVED from the choice rather than typed. A free-text
 * subject and a category are two descriptions of the same thing, and
 * they disagree the moment anyone is in a hurry.
 */
export function RaiseTicketModal({
  open,
  onOpenChange,
  orderId: fixedOrderId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Supplied when raised FROM an order — then the field is not asked for. */
  readonly orderId?: string;
}): ReactElement {
  const toast = useToast();
  const create = useCreateTicket();
  const categories = useIssueCategories();

  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(
    () => (categories.data ?? []).find((c) => c.externalId === categoryId),
    [categories.data, categoryId],
  );
  const subs = chosen?.subcategories ?? [];
  const needsSub = subs.length > 0;
  const chosenSub = subs.find((sc) => sc.externalId === subcategoryId);

  // Everything the seller has actually chosen, most specific last.
  const subject = chosenSub?.label ?? chosen?.label ?? '';
  const ready =
    chosen !== undefined &&
    (!needsSub || chosenSub !== undefined) &&
    description.trim().length >= MIN_DESCRIPTION;

  function reset(): void {
    setCategoryId('');
    setSubcategoryId('');
    setDescription('');
    setOrderId('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    const order = fixedOrderId ?? (orderId.trim() === '' ? undefined : orderId.trim());
    try {
      await create.mutateAsync({
        subject,
        description: description.trim(),
        ...(order === undefined ? {} : { orderId: order }),
        ...(chosen === undefined ? {} : { issueCategoryExternalId: chosen.externalId }),
        ...(chosenSub === undefined ? {} : { issueSubcategoryExternalId: chosenSub.externalId }),
      });
      toast.success('Issue raised. We will come back to you on the ticket.');
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      size="md"
      title="Raise an issue"
      description="Tell us what is wrong. We take it up with the courier and reply on the ticket."
    >
      <div className="space-y-3">
        <FormField label="What is the problem" htmlFor="ticket-category" required>
          <Select
            id="ticket-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              // A subcategory from the previous category is not a valid
              // answer to this one.
              setSubcategoryId('');
            }}
          >
            <option value="">Choose…</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.externalId} value={c.externalId}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>

        {needsSub ? (
          <FormField label="Which one" htmlFor="ticket-subcategory" required>
            <Select
              id="ticket-subcategory"
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
            >
              <option value="">Choose…</option>
              {subs.map((sc) => (
                <option key={sc.externalId} value={sc.externalId}>
                  {sc.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {fixedOrderId === undefined ? (
          <FormField
            label="Order"
            htmlFor="ticket-order"
            hint="Optional, but including it gets you an answer far faster. Copy the ID from the order page."
          >
            <Input
              id="ticket-order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="0198f3c2-…"
              autoComplete="off"
            />
          </FormField>
        ) : null}

        <FormField
          label="What happened"
          htmlFor="ticket-description"
          required
          hint={`What you expected, what actually happened, and anything the customer told you. ${description.length}/${MAX_DESCRIPTION}`}
        >
          <Textarea
            id="ticket-description"
            rows={4}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {categories.isError ? (
          <ErrorNote
            message={serverVerdict(categories.error)}
            retry={() => void categories.refetch()}
          />
        ) : null}
        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!ready || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Raising…' : 'Raise issue'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
