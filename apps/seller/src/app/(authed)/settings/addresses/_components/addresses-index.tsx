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
  Section,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  useAddresses,
  useCreateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
  type AddressInput,
  type AddressView,
} from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The seller's own addresses.
 *
 * Not recipient addresses — these are yours: where stock ships FROM in
 * Bangladesh, where your office is, where Indian returns should go if
 * you ever take them back directly. The BD origin one is the load-
 * bearing entry: it is what a consignment is booked against, so a
 * seller with none cannot send us anything.
 *
 * Hence the empty state names that specifically rather than saying "no
 * addresses" and leaving you to work out which kind you needed.
 */
const TYPE_LABELS: Record<string, string> = {
  BD_ORIGIN: 'Bangladesh — ships from here',
  BD_OFFICE: 'Bangladesh — office',
  IN_RETURN: 'India — returns',
  IN_WAREHOUSE: 'India — warehouse',
  RECIPIENT: 'Recipient',
};

export function AddressesIndex(): ReactElement {
  const list = useAddresses();
  const setDefault = useSetDefaultAddress();
  const remove = useDeleteAddress();
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AddressView | null>(null);

  const items = list.data ?? [];
  const hasOrigin = items.some((a) => a.type === 'BD_ORIGIN');

  return (
    <div>
      <PageHeader
        title="Your addresses"
        subtitle="Where your stock ships from, and where you can be reached. These are yours — customer addresses live on the order."
        action={<Button onClick={() => setAdding(true)}>Add an address</Button>}
      />

      {!list.isLoading && !hasOrigin && (
        <ErrorNote message="You have no Bangladesh origin address. A consignment is booked against one, so add it before sending stock." />
      )}

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={3} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No addresses yet"
            description="Start with the Bangladesh address your stock ships from — nothing can be booked without it."
            action={<Button onClick={() => setAdding(true)}>Add an address</Button>}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th>Contact</Th>
                <Th>Where</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {items.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      {a.label ?? '—'}
                      {a.isDefault && <StatusBadge kind="confirmed" label="default" />}
                    </span>
                  </Td>
                  <Td>{TYPE_LABELS[a.type] ?? a.type}</Td>
                  <Td>
                    <div>{a.contactName}</div>
                    <div className="text-text-faint text-xs">{a.contactPhone}</div>
                  </Td>
                  <Td>
                    <div>{a.line1}</div>
                    <div className="text-text-faint text-xs">
                      {a.city}, {a.stateProvince} {a.postalCode}
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      {!a.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setDefault.isPending}
                          onClick={() => setDefault.mutate({ id: a.id })}
                        >
                          Make default
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(a)}>
                        Remove
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {(setDefault.error !== null || remove.error !== null) && (
        <ErrorNote message={serverVerdict(setDefault.error ?? remove.error)} />
      )}

      <AddAddress open={adding} onClose={() => setAdding(false)} />

      <Modal
        open={confirmDelete !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
        tone="default"
        title="Remove this address?"
        description="Orders and consignments that already reference it keep their own copy, so history is not affected."
      >
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setConfirmDelete(null)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={remove.isPending}
            onClick={() => {
              if (confirmDelete !== null) {
                remove.mutate(
                  { id: confirmDelete.id },
                  { onSuccess: () => setConfirmDelete(null) },
                );
              }
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function AddAddress({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const create = useCreateAddress();
  const [form, setForm] = useState<AddressInput>({
    type: 'BD_ORIGIN',
    label: '',
    contactName: '',
    contactPhone: '',
    line1: '',
    city: '',
    stateProvince: '',
    postalCode: '',
  });

  function set(key: keyof AddressInput, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close(): void {
    create.reset();
    onClose();
  }

  const complete =
    form.contactName.trim() !== '' &&
    form.contactPhone.trim() !== '' &&
    form.line1.trim() !== '' &&
    form.city.trim() !== '' &&
    form.stateProvince.trim() !== '' &&
    form.postalCode.trim() !== '';

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Add an address"
    >
      <Section title="What kind">
        <FormField label="Type" htmlFor="ad-type">
          <Select id="ad-type" value={form.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(TYPE_LABELS)
              .filter(([k]) => k !== 'RECIPIENT')
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="Label" htmlFor="ad-label" hint="Optional. How you refer to it.">
          <Input
            id="ad-label"
            value={form.label ?? ''}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Dhaka warehouse"
          />
        </FormField>
      </Section>

      <Section title="Who to contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="ad-name">
            <Input
              id="ad-name"
              value={form.contactName}
              onChange={(e) => set('contactName', e.target.value)}
            />
          </FormField>
          <FormField label="Phone" htmlFor="ad-phone" hint="With country code, e.g. +8801712345678">
            <Input
              id="ad-phone"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
              placeholder="+8801712345678"
            />
          </FormField>
        </div>
      </Section>

      <Section title="Where">
        <FormField label="Address line 1" htmlFor="ad-l1">
          <Input id="ad-l1" value={form.line1} onChange={(e) => set('line1', e.target.value)} />
        </FormField>
        <FormField label="Address line 2" htmlFor="ad-l2" hint="Optional">
          <Input
            id="ad-l2"
            value={form.line2 ?? ''}
            onChange={(e) => set('line2', e.target.value)}
          />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="City" htmlFor="ad-city">
            <Input id="ad-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="State / division" htmlFor="ad-state">
            <Input
              id="ad-state"
              value={form.stateProvince}
              onChange={(e) => set('stateProvince', e.target.value)}
            />
          </FormField>
          <FormField label="Postal code" htmlFor="ad-pin">
            <Input
              id="ad-pin"
              value={form.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
            />
          </FormField>
        </div>
      </Section>

      {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={!complete || create.isPending}
          onClick={() =>
            create.mutate(
              {
                // exactOptionalPropertyTypes: an optional field must be
                // ABSENT, not present-and-undefined.
                type: form.type,
                contactName: form.contactName.trim(),
                contactPhone: form.contactPhone.trim(),
                line1: form.line1.trim(),
                city: form.city.trim(),
                stateProvince: form.stateProvince.trim(),
                postalCode: form.postalCode.trim(),
                ...(form.label !== undefined && form.label.trim() !== ''
                  ? { label: form.label.trim() }
                  : {}),
                ...(form.line2 !== undefined && form.line2.trim() !== ''
                  ? { line2: form.line2.trim() }
                  : {}),
              },
              { onSuccess: close },
            )
          }
        >
          {create.isPending ? 'Saving…' : 'Save address'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
