'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Num,
  Select,
  SkeletonRows,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useCustomer, useDeleteCustomer, useUpdateCustomer } from '@/lib/account-hooks';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * One customer record, and the two things you can do to it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The customers list is read-only. A name typed wrong on the first
 * order — or a stale email that bounces every confirmation — followed
 * that customer forever, because ORD-7 dedups on `(sellerId, phone)`
 * and re-encountering them on a new order deliberately does NOT
 * overwrite the seller-curated name. So the wrong value was permanent
 * and there was no screen to fix it. GET/PATCH/DELETE have existed on
 * `/seller/customers/:id` since M6 with no caller at all.
 *
 * ── THE PHONE IS NOT EDITABLE, AND THAT IS DELIBERATE ────────────────
 * `phoneE164` is the identity (ORD-7). The server has no parameter for
 * it by construction, so offering a field would be offering something
 * that cannot be saved. A wrong phone is a different customer: place
 * the next order against the right number and remove this record.
 *
 * ── REMOVE IS A SOFT DELETE ──────────────────────────────────────────
 * The row is hidden, the order history behind it is untouched, and a
 * new order to the same number revives the record rather than creating
 * a second one. Worth saying out loud, because "delete" in a COD
 * business reads like it destroys the RTO history you priced them on.
 */
export function CustomerDetailPanel({
  customerId,
  onDeleted,
}: {
  readonly customerId: string;
  /** Let the parent drop this panel — the record it is showing is gone. */
  readonly onDeleted?: () => void;
}): ReactElement | null {
  // COSMETIC (FE-2), and TWO permissions rather than one: the server
  // guards the read on `customers.view` and both writes on
  // `customers.manage`. They were the same key until the write was split
  // out, which meant a company could not say "let them look" — the only
  // way to withhold the edit was to withhold the whole customer list.
  const identity = useSellerIdentity();
  const mayView = can(identity, 'customers.view');
  const mayManage = can(identity, 'customers.manage');

  const toast = useToast();
  const detail = useCustomer(customerId);
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [language, setLanguage] = useState('en');

  if (!mayView) return null;

  const c = detail.data;

  function openEditor(): void {
    // Seed from the loaded record at open time rather than in an effect:
    // an effect would clobber whatever the operator has typed the moment
    // a background refetch lands.
    if (c === undefined) return;
    setName(c.name ?? '');
    setEmail(c.email ?? '');
    setAltPhone(c.altPhoneE164 ?? '');
    setRiskNotes(c.riskNotes ?? '');
    setLanguage(c.preferredLanguage ?? 'en');
    setError(null);
    setEditing(true);
  }

  async function onSave(): Promise<void> {
    if (c === undefined) return;
    setError(null);
    try {
      // Only CHANGED fields go on the wire. The API runs
      // forbidNonWhitelisted, so an extra key is a 400 on the whole
      // call — and sending an untouched field would overwrite a value
      // another teammate corrected while this modal was open.
      //
      // Cleared-out fields send `null`, which the DTO's @IsOptional
      // accepts and the service writes through. Sending '' instead
      // would fail @IsEmail and store a meaningless empty string in
      // the others.
      const body = changedFields(c, {
        name: name.trim(),
        email: email.trim(),
        altPhoneE164: altPhone.trim(),
        riskNotes: riskNotes.trim(),
        preferredLanguage: language,
      });
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      await update.mutateAsync({ id: customerId, body });
      setEditing(false);
      toast.success('Customer updated.');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onRemove(): Promise<void> {
    setError(null);
    try {
      await remove.mutateAsync({ id: customerId });
      setRemoving(false);
      toast.success('Customer removed.');
      onDeleted?.();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // The server's own E.164 shape, mirrored so the operator is told here
  // rather than after a round trip. The server still decides (FE-2).
  const altPhoneMalformed = altPhone.trim() !== '' && !/^\+[1-9]\d{6,14}$/.test(altPhone.trim());

  return (
    <Card>
      <CardHeader
        title={c?.name ?? c?.phoneE164 ?? 'Customer'}
        subtitle={c === undefined ? undefined : c.phoneE164}
        action={
          mayManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={c === undefined}
                onClick={() => openEditor()}
              >
                Correct details
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={c === undefined}
                onClick={() => {
                  setError(null);
                  setRemoving(true);
                }}
              >
                Remove
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody>
        {detail.isLoading ? (
          <SkeletonRows rows={3} cols={2} />
        ) : detail.isError ? (
          <ErrorNote message={serverVerdict(detail.error)} retry={() => void detail.refetch()} />
        ) : c === undefined ? null : (
          <DescriptionList
            columns={3}
            items={[
              {
                label: 'Phone',
                value: (
                  <>
                    <span className="font-mono text-xs">{c.phoneE164}</span>
                    <span className="text-text-faint ml-2 text-xs">fixed</span>
                  </>
                ),
              },
              { label: 'Name', value: c.name ?? '—' },
              { label: 'Email', value: c.email ?? '—' },
              {
                label: 'Alternate phone',
                value:
                  c.altPhoneE164 === null ? (
                    '—'
                  ) : (
                    <span className="font-mono text-xs">{c.altPhoneE164}</span>
                  ),
              },
              { label: 'Call language', value: c.preferredLanguage === 'hi' ? 'Hindi' : 'English' },
              { label: 'Risk', value: c.riskLevel === null ? '—' : c.riskLevel.toLowerCase() },
              { label: 'Orders', value: <Num value={c.totalOrdersCount} /> },
              { label: 'Delivered', value: <Num value={c.successfulOrdersCount} /> },
              {
                label: 'Returned',
                value:
                  c.rtoCount === 0 ? (
                    <span className="text-text-faint">0</span>
                  ) : (
                    <span className="text-[var(--color-bad)]">{c.rtoCount}</span>
                  ),
              },
              {
                label: 'First order',
                value:
                  c.firstOrderAt === null
                    ? '—'
                    : new Date(c.firstOrderAt).toLocaleDateString('en-IN'),
              },
              {
                label: 'Last order',
                value:
                  c.lastOrderAt === null
                    ? '—'
                    : new Date(c.lastOrderAt).toLocaleDateString('en-IN'),
              },
              { label: 'Notes', value: c.riskNotes ?? '—' },
            ]}
          />
        )}
      </CardBody>

      {/* ── Correct ───────────────────────────────────────────────── */}
      <Modal
        open={editing}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(false);
            setError(null);
          }
        }}
        title="Correct customer details"
        description={c?.phoneE164}
      >
        <p className="text-text-muted mb-3 text-sm">
          These are the details used when we call to confirm an order and when we email this
          customer. The phone number is their identity here and cannot be changed — a different
          number is a different customer.
        </p>

        {error !== null && <ErrorNote message={error} />}

        <div className="space-y-3">
          <FormField label="Name" hint="What the call centre will greet them by.">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
          </FormField>
          <FormField
            label="Email"
            hint="Where order updates go. Leave blank if you do not have it."
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          </FormField>
          <FormField
            label="Alternate phone"
            hint="Full international form, e.g. +919812345678. Tried when the main number does not answer."
            error={altPhoneMalformed ? 'Must start with + and the country code.' : undefined}
          >
            <Input
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
              placeholder="+919812345678"
              maxLength={16}
            />
          </FormField>
          <FormField label="Call language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </Select>
          </FormField>
          <FormField
            label="Notes"
            hint="Anything the agent should know before dialling. Visible to Skydrop staff handling your orders."
          >
            <Textarea
              value={riskNotes}
              onChange={(e) => setRiskNotes(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </FormField>
        </div>

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={altPhoneMalformed || update.isPending}
            onClick={() => void onSave()}
          >
            {update.isPending ? 'Saving…' : 'Save corrections'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Remove ────────────────────────────────────────────────── */}
      <Modal
        open={removing}
        onOpenChange={(next) => {
          if (!next) {
            setRemoving(false);
            setError(null);
          }
        }}
        title="Remove this customer"
        description={c?.phoneE164}
        tone="critical"
        size="sm"
      >
        <p className="text-text-muted mb-3 text-sm">
          The record disappears from your customer list. Their past orders are untouched, and if you
          ship to this number again the record comes back with its history intact — so this hides a
          contact, it does not erase what happened.
        </p>

        {error !== null && <ErrorNote message={error} />}

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={() => setRemoving(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={remove.isPending}
            onClick={() => void onRemove()}
          >
            {remove.isPending ? 'Removing…' : 'Remove customer'}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}

/**
 * The five editable fields, narrowed to what actually moved.
 *
 * `null` means "the operator emptied this" — the DTO's @IsOptional lets
 * null through and the service writes it, which is the only way to
 * clear a wrong email. An unchanged field is ABSENT, not null: sending
 * it would silently revert an edit made elsewhere between load and save.
 */
function changedFields(
  current: {
    name: string | null;
    email: string | null;
    altPhoneE164: string | null;
    riskNotes: string | null;
    preferredLanguage: string | null;
  },
  next: {
    name: string;
    email: string;
    altPhoneE164: string;
    riskNotes: string;
    preferredLanguage: string;
  },
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pairs = [
    ['name', current.name, next.name],
    ['email', current.email, next.email],
    ['altPhoneE164', current.altPhoneE164, next.altPhoneE164],
    ['riskNotes', current.riskNotes, next.riskNotes],
    ['preferredLanguage', current.preferredLanguage ?? 'en', next.preferredLanguage],
  ] as const;
  for (const [key, was, now] of pairs) {
    const wasText = was ?? '';
    if (wasText === now) continue;
    out[key] = now === '' ? null : now;
  }
  return out;
}
