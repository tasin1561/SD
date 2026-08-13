'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useCreateWarehouse, useUpdateWarehouse, type WarehouseSummary } from '@/lib/api-hooks';

/**
 * Opening a second building.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * POST /admin/warehouses and PATCH /admin/warehouses/:id have shipped
 * since M5 and nothing called either. The warehouse screens are all
 * read-only, so creating a warehouse meant a hand-written INSERT against
 * production — which also skips the service's default-topology step, and
 * a warehouse with no MAIN zone and no FLOOR bin is a building that
 * cannot receive stock (BIN-1). Creating it here provisions that for you.
 *
 * ── WHY CODE IS EDITABLE ONCE AND NEVER AGAIN ────────────────────────
 * `code` is the natural key `ops.default_warehouse_id` and every operator
 * habit points at. The UpdateWarehouseDto has no `code` field at all, so
 * sending one is a 400 under forbidNonWhitelisted — the field is rendered
 * disabled in edit mode rather than hidden, because an operator looking
 * for it needs to see that it exists and is fixed.
 *
 * ── WHY BLANK OPTIONALS ARE OMITTED, NOT SENT ────────────────────────
 * `status`, `countryCode` and `timezone` are @IsOptional with server-side
 * defaults. Sending `status: ''` fails @IsEnum and `countryCode: ''`
 * fails @Length(2,2) — an empty string is a value, not an absence. Every
 * optional is dropped from the body when untouched, and on edit only the
 * fields that actually CHANGED are sent, so a PATCH that alters the name
 * cannot silently restate a timezone somebody else just corrected.
 */

const STATUSES = [
  { value: 'ACTIVE', label: 'Active — receives stock and ships' },
  { value: 'INACTIVE', label: 'Inactive — not in use' },
  { value: 'MAINTENANCE', label: 'Maintenance — temporarily not operating' },
] as const;

/**
 * The server takes any string ≤64, which means a typo is accepted and
 * only surfaces later as a wrong local hour on the wallet auto-sweep and
 * every displayed timestamp. A list of the zones we actually operate in
 * removes that failure mode; an existing value outside it is preserved
 * below rather than silently rewritten.
 */
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dhaka', 'UTC'] as const;

/** Mirrors CreateWarehouseDto's @Matches — told before submitting, still decided by the server (FE-2). */
const CODE_RE = /^[A-Z0-9-]+$/;

export function WarehouseFormPanel({
  warehouse,
}: {
  /** Absent = create. Present = edit that building. */
  readonly warehouse?: WarehouseSummary;
}): ReactElement | null {
  // COSMETIC (FE-2). /warehouse is gated on `warehouse.view`; both these
  // endpoints require `warehouse.manage`. Without this, every reader sees
  // a button the server refuses.
  const mayManage = usePermission('warehouse.manage');
  const toast = useToast();
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse(warehouse?.id ?? '');

  const isEdit = warehouse !== undefined;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(warehouse?.code ?? '');
  const [name, setName] = useState(warehouse?.name ?? '');
  const [status, setStatus] = useState(warehouse?.status ?? 'ACTIVE');
  const [countryCode, setCountryCode] = useState(warehouse?.countryCode ?? 'IN');
  const [timezone, setTimezone] = useState(warehouse?.timezone ?? 'Asia/Kolkata');

  function reset(): void {
    setCode(warehouse?.code ?? '');
    setName(warehouse?.name ?? '');
    setStatus(warehouse?.status ?? 'ACTIVE');
    setCountryCode(warehouse?.countryCode ?? 'IN');
    setTimezone(warehouse?.timezone ?? 'Asia/Kolkata');
    setError(null);
  }

  function close(): void {
    setOpen(false);
    reset();
  }

  const trimmedCode = code.trim().toUpperCase();
  const trimmedName = name.trim();
  const trimmedTz = timezone.trim();
  const cc = countryCode.trim().toUpperCase();

  // The DTO's own floors, mirrored so the refusal arrives before the
  // round trip. The server still decides.
  const codeBad =
    !isEdit && (trimmedCode.length < 2 || trimmedCode.length > 32 || !CODE_RE.test(trimmedCode));
  const nameBad = trimmedName === '' || trimmedName.length > 120;
  const ccBad = cc.length !== 2;
  const tzBad = trimmedTz === '' || trimmedTz.length > 64;
  const invalid = codeBad || nameBad || ccBad || tzBad;

  const pending = isEdit ? update.isPending : create.isPending;

  // On edit, an untouched field is left OUT of the PATCH entirely rather
  // than resent — a no-op field in the body is still a write the audit
  // records as a change.
  const changed = isEdit
    ? {
        ...(trimmedName !== warehouse.name ? { name: trimmedName } : {}),
        ...(status !== warehouse.status ? { status } : {}),
        ...(cc !== warehouse.countryCode ? { countryCode: cc } : {}),
        ...(trimmedTz !== warehouse.timezone ? { timezone: trimmedTz } : {}),
      }
    : {};
  const nothingChanged = isEdit && Object.keys(changed).length === 0;

  async function submit(): Promise<void> {
    setError(null);
    try {
      if (isEdit) {
        const row = await update.mutateAsync(changed);
        toast.success(`${row.code} saved.`);
      } else {
        const row = await create.mutateAsync({
          code: trimmedCode,
          name: trimmedName,
          status,
          countryCode: cc,
          timezone: trimmedTz,
        });
        toast.success(`Warehouse ${row.code} created, with a MAIN zone and a FLOOR bin.`);
      }
      close();
    } catch (err) {
      // WAREHOUSE_CODE_TAKEN is the one an operator hits in practice, and
      // it names the clashing code — worth showing exactly as written.
      setError(serverVerdict(err));
    }
  }

  if (!mayManage) return null;

  // An existing zone outside our curated list is a fact, not a mistake to
  // correct on the operator's behalf.
  const tzOptions = TIMEZONES.includes(trimmedTz as (typeof TIMEZONES)[number])
    ? TIMEZONES
    : ([...TIMEZONES, trimmedTz] as readonly string[]);

  return (
    <>
      <Button variant={isEdit ? 'ghost' : 'primary'} size="sm" onClick={() => setOpen(true)}>
        {isEdit ? 'Edit' : 'New warehouse'}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={isEdit ? `Edit ${warehouse.code}` : 'New warehouse'}
      >
        <p className="text-text-muted mb-3 text-sm">
          {isEdit
            ? 'The code is fixed — settings, manifests and pick sheets all refer to it. Everything else here is safe to change; none of it moves stock.'
            : 'A new building starts with a MAIN zone and a FLOOR bin so it can receive stock immediately. Location tracking starts off; turn it on from Bins once the shelving is laid out.'}
        </p>

        {error !== null && <ErrorNote message={error} />}

        <div className="space-y-3">
          <FormField
            label="Code"
            required={!isEdit}
            hint={
              isEdit
                ? 'Immutable — the natural key other settings point at.'
                : 'Uppercase letters, digits and dashes, 2–32 characters. e.g. BLR-01'
            }
            error={
              !isEdit && trimmedCode !== '' && codeBad
                ? 'Uppercase A–Z, 0–9 and dashes only, 2–32 characters.'
                : undefined
            }
          >
            <Input
              value={isEdit ? warehouse.code : code}
              disabled={isEdit}
              maxLength={32}
              placeholder="BLR-01"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </FormField>

          <FormField label="Name" required hint="What people call the building.">
            <Input
              value={name}
              maxLength={120}
              placeholder="Bangalore fulfilment centre"
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="Status"
            hint="Only ACTIVE warehouses are offered for receiving and picking."
          >
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Country"
              hint="ISO two-letter code."
              error={cc !== '' && ccBad ? 'Exactly two letters.' : undefined}
            >
              <Input
                value={countryCode}
                maxLength={2}
                placeholder="IN"
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField label="Timezone" hint="Drives the local hour on anything scheduled here.">
              <Select value={trimmedTz} onChange={(e) => setTimezone(e.target.value)}>
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={invalid || nothingChanged || pending}
            onClick={() => void submit()}
          >
            {pending
              ? 'Saving…'
              : isEdit
                ? nothingChanged
                  ? 'No changes'
                  : 'Save changes'
                : 'Create warehouse'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
