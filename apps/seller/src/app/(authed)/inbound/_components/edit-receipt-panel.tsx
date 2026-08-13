'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  SkeletonRows,
  useToast,
} from '@skydrop/ui/components';
import {
  useGoodsReceipt,
  useUpdateGoodsReceipt,
  type DeclareReceiptLine,
  type GoodsReceiptDetailView,
  type GoodsReceiptView,
  type UpdateGoodsReceiptBody,
} from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

/**
 * Correct a consignment that has been declared but not yet received.
 *
 * Without this the only correction is cancel-and-re-declare, which
 * throws away the receipt number receiving is already expecting and
 * turns a mistyped quantity into a second consignment nobody sent.
 *
 * PENDING only, and that is the server's rule (`assertStatus`), not a
 * cosmetic one: once the warehouse is ARRIVING, the count they are
 * checking against must stop moving underneath them.
 */
export function EditReceiptPanel({
  receipt,
  onClose,
}: {
  readonly receipt: GoodsReceiptView | null;
  readonly onClose: () => void;
}): ReactElement | null {
  const canManage = can(useSellerIdentity(), 'inbound.manage');

  // The server needs `inbound.manage` for PATCH; showing the control to
  // someone holding only `inbound.view` teaches them a 403.
  if (!canManage || receipt === null || receipt.status !== 'PENDING') return null;

  // Keyed on the receipt id so opening a different consignment mounts a
  // fresh form — a reset effect would leave one render showing the
  // previous consignment's lines against the new one's number.
  return <EditReceiptForm key={receipt.id} receipt={receipt} onClose={onClose} />;
}

/** One editable line. Strings throughout: an input's value is a string,
 *  and coercing on every keystroke makes "" and 0 indistinguishable. */
interface LineDraft {
  readonly key: string;
  readonly variantId: string;
  /** SKU + product name for a line that came from the server. Null for a
   *  line the operator is adding, which has only a variant id to go on. */
  readonly label: string | null;
  readonly expectedQty: string;
  readonly unitCostInr: string;
  readonly manufacturedAt: string;
  readonly expiresAt: string;
}

interface FormState {
  readonly expectedArrivalAt: string;
  readonly sellerReference: string;
  readonly lines: readonly LineDraft[];
}

// Mirrors of the server DTO's own bounds, so the operator is told before
// they submit rather than by a 400 after it. These are copies of a
// documented constraint, NOT a second rule — the server still decides.
const REFERENCE_MAX = 120; // @MaxLength(120)
const QTY_MIN = 1; // @Min(1)
const QTY_MAX = 1_000_000; // @Max(1_000_000)

function EditReceiptForm({
  receipt,
  onClose,
}: {
  readonly receipt: GoodsReceiptView;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const detail = useGoodsReceipt(receipt.id);
  const update = useUpdateGoodsReceipt();

  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    if (form !== null || !detail.data) return;
    const seeded = seedForm(detail.data);
    setForm(seeded);
    setInitial(JSON.stringify(seeded));
  }, [detail.data, form]);

  const dirty = form !== null && initial !== null && JSON.stringify(form) !== initial;
  const problem = form === null ? null : firstProblem(form);

  function patch(next: Partial<FormState>): void {
    setForm((f) => (f === null ? f : { ...f, ...next }));
  }

  function patchLine(key: string, next: Partial<LineDraft>): void {
    setForm((f) =>
      f === null ? f : { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...next } : l)) },
    );
  }

  function save(): void {
    if (form === null) return;
    const body: UpdateGoodsReceiptBody = {};
    const seeded = detail.data ? seedForm(detail.data) : null;
    if (seeded === null) return;

    // Only send what moved. `lines` is a FULL REPLACE server-side —
    // resending an unchanged set deletes and recreates every row for
    // nothing and records a linesReplaced audit that misdescribes what
    // happened.
    if (form.expectedArrivalAt !== seeded.expectedArrivalAt) {
      // null clears it. The service reads `input.expectedArrivalAt ?
      // new Date(...) : null`, and @IsOptional() skips validation for
      // null — an empty STRING would fail @IsDateString and 400.
      body.expectedArrivalAt =
        form.expectedArrivalAt === '' ? null : new Date(form.expectedArrivalAt).toISOString();
    }
    if (form.sellerReference !== seeded.sellerReference) {
      body.sellerReference =
        form.sellerReference.trim() === '' ? null : form.sellerReference.trim();
    }
    if (JSON.stringify(form.lines) !== JSON.stringify(seeded.lines)) {
      body.lines = form.lines.map(toLinePayload);
    }

    update.mutate(
      { id: receipt.id, body },
      {
        onSuccess: () => {
          toast.success(`${receipt.receiptNumber} updated`);
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={`Correct ${receipt.receiptNumber}`}
      description="Only possible while the consignment is still pending. Once the warehouse starts receiving it, what you declared is what they count against."
    >
      {detail.isLoading || form === null ? (
        <SkeletonRows rows={4} />
      ) : detail.isError ? (
        <ErrorNote message={serverVerdict(detail.error)} retry={() => void detail.refetch()} />
      ) : (
        <>
          <Section
            title="What is in it"
            subtitle="Replacing a line replaces the whole list, so leave the ones that are right alone."
          >
            {form.lines.map((line) => (
              <div key={line.key} className="border-border mb-3 rounded-[7px] border p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  {line.label === null ? (
                    <FormField label="Variant id" htmlFor={`v-${line.key}`}>
                      <Input
                        id={`v-${line.key}`}
                        value={line.variantId}
                        onChange={(e) => patchLine(line.key, { variantId: e.target.value })}
                        placeholder="From your catalog"
                      />
                    </FormField>
                  ) : (
                    <div className="text-text-bright text-sm">{line.label}</div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ lines: form.lines.filter((l) => l.key !== line.key) })}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <FormField label="Quantity" htmlFor={`q-${line.key}`}>
                    <Input
                      id={`q-${line.key}`}
                      type="number"
                      min={QTY_MIN}
                      max={QTY_MAX}
                      value={line.expectedQty}
                      onChange={(e) => patchLine(line.key, { expectedQty: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Unit cost (₹)" htmlFor={`c-${line.key}`} hint="Optional">
                    <Input
                      id={`c-${line.key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitCostInr}
                      onChange={(e) => patchLine(line.key, { unitCostInr: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Manufactured" htmlFor={`m-${line.key}`} hint="Optional">
                    <Input
                      id={`m-${line.key}`}
                      type="date"
                      value={line.manufacturedAt}
                      onChange={(e) => patchLine(line.key, { manufacturedAt: e.target.value })}
                    />
                  </FormField>
                  {/* Carried even when unedited: a line sent back without
                      its expiry loses it, and FEFO picking is decided on
                      exactly this date. */}
                  <FormField label="Expires" htmlFor={`e-${line.key}`} hint="Optional">
                    <Input
                      id={`e-${line.key}`}
                      type="date"
                      value={line.expiresAt}
                      onChange={(e) => patchLine(line.key, { expiresAt: e.target.value })}
                    />
                  </FormField>
                </div>
              </div>
            ))}

            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                patch({
                  lines: [
                    ...form.lines,
                    {
                      key: `new-${form.lines.length}-${Date.now()}`,
                      variantId: '',
                      label: null,
                      expectedQty: '',
                      unitCostInr: '',
                      manufacturedAt: '',
                      expiresAt: '',
                    },
                  ],
                })
              }
            >
              Add a line
            </Button>
          </Section>

          <Section title="When and what you call it">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Expected arrival"
                htmlFor="gr-edit-eta"
                hint="Clear it if you no longer know."
              >
                <Input
                  id="gr-edit-eta"
                  type="date"
                  value={form.expectedArrivalAt}
                  onChange={(e) => patch({ expectedArrivalAt: e.target.value })}
                />
              </FormField>
              <FormField
                label="Your reference"
                htmlFor="gr-edit-ref"
                hint={`Optional. Up to ${REFERENCE_MAX} characters.`}
              >
                <Input
                  id="gr-edit-ref"
                  maxLength={REFERENCE_MAX}
                  value={form.sellerReference}
                  onChange={(e) => patch({ sellerReference: e.target.value })}
                />
              </FormField>
            </div>
          </Section>

          {problem !== null && <p className="text-[var(--color-critical)] text-xs">{problem}</p>}
          {update.error !== null && <ErrorNote message={serverVerdict(update.error)} />}

          <ModalFooter>
            <Button variant="ghost" size="md" onClick={onClose}>
              Discard changes
            </Button>
            <Button
              size="md"
              disabled={!dirty || problem !== null || update.isPending}
              onClick={save}
            >
              {update.isPending ? 'Saving…' : 'Save corrections'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function seedForm(d: GoodsReceiptDetailView): FormState {
  return {
    expectedArrivalAt: dayOf(d.expectedArrivalAt),
    sellerReference: d.sellerReference ?? '',
    lines: d.lines.map((l, i) => ({
      key: l.id === '' ? `seed-${i}` : l.id,
      variantId: l.variantId,
      label: [l.variant.product.name, l.variant.variantLabel, l.variant.skuCode]
        .filter((s): s is string => typeof s === 'string' && s !== '')
        .join(' · '),
      expectedQty: String(l.expectedQty),
      unitCostInr: l.unitCostInr ?? '',
      manufacturedAt: dayOf(l.manufacturedAt),
      expiresAt: dayOf(l.expiresAt),
    })),
  };
}

/** `<input type="date">` speaks days; the column stores a timestamp.
 *  Round-tripping at day precision is what the seller typed in the
 *  first place, so nothing meaningful is lost. */
function dayOf(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 10);
}

/**
 * The wire shape is EXACTLY DeclareReceiptLineDto. The API runs
 * forbidNonWhitelisted, so echoing a server row back with its `id`,
 * `receivedQty` or `variant` object 400s the entire request.
 */
function toLinePayload(l: LineDraft): DeclareReceiptLine {
  return {
    variantId: l.variantId.trim(),
    expectedQty: Number(l.expectedQty),
    ...(l.unitCostInr.trim() === '' ? {} : { unitCostInr: Number(l.unitCostInr) }),
    ...(l.manufacturedAt === ''
      ? {}
      : { manufacturedAt: new Date(l.manufacturedAt).toISOString() }),
    ...(l.expiresAt === '' ? {} : { expiresAt: new Date(l.expiresAt).toISOString() }),
  };
}

/** First reason the server would refuse, phrased for the operator. Only
 *  mirrors the DTO's stated bounds — anything subtler is the server's. */
function firstProblem(f: FormState): string | null {
  if (f.lines.length === 0) return 'A consignment needs at least one line. Cancel it instead.';
  for (const l of f.lines) {
    if (l.variantId.trim() === '') return 'Every line needs a variant id.';
    const qty = Number(l.expectedQty);
    if (!Number.isInteger(qty) || qty < QTY_MIN || qty > QTY_MAX) {
      return `Quantity must be a whole number between ${QTY_MIN} and ${QTY_MAX}.`;
    }
    if (l.unitCostInr.trim() !== '' && !(Number(l.unitCostInr) >= 0)) {
      return 'Unit cost cannot be negative.';
    }
  }
  if (f.sellerReference.length > REFERENCE_MAX) {
    return `Your reference is limited to ${REFERENCE_MAX} characters.`;
  }
  return null;
}
