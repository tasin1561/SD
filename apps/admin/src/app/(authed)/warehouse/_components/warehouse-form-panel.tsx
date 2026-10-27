'use client';

import { useState, type ReactElement } from 'react';
import { Warehouse } from 'lucide-react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import './benches.css';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useCreateWarehouse, useUpdateWarehouse, type WarehouseSummary } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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

const STATUSES = (t: Translate<MessageKey>) =>
  [
    { value: 'ACTIVE', label: t('warehouseWarehouseFormPanel.activeReceivesStockAndShips') },
    { value: 'INACTIVE', label: t('warehouseWarehouseFormPanel.inactiveNotInUse') },
    {
      value: 'MAINTENANCE',
      label: t('warehouseWarehouseFormPanel.maintenanceTemporarilyNotOperating'),
    },
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
  const t = useT();
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
  const [fulfilsOrders, setFulfilsOrders] = useState(warehouse?.fulfilsOrders ?? true);

  function reset(): void {
    setCode(warehouse?.code ?? '');
    setName(warehouse?.name ?? '');
    setStatus(warehouse?.status ?? 'ACTIVE');
    setCountryCode(warehouse?.countryCode ?? 'IN');
    setTimezone(warehouse?.timezone ?? 'Asia/Kolkata');
    setFulfilsOrders(warehouse?.fulfilsOrders ?? true);
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
        ...(fulfilsOrders !== warehouse.fulfilsOrders ? { fulfilsOrders } : {}),
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
          fulfilsOrders,
        });
        toast.success(
          t('warehouseWarehouseFormPanel.warehouseCreatedWithAMain', { code: row.code }),
        );
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
        {isEdit
          ? t('warehouseWarehouseFormPanel.edit')
          : t('warehouseWarehouseFormPanel.newWarehouse')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={
          isEdit
            ? t('warehouseWarehouseFormPanel.edit2', { code: warehouse.code })
            : t('warehouseWarehouseFormPanel.newWarehouse')
        }
        icon={<Warehouse size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={close}>
              {t('warehouseWarehouseFormPanel.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={invalid || nothingChanged || pending}
              onClick={() => void submit()}
            >
              {pending
                ? t('warehouseWarehouseFormPanel.saving')
                : isEdit
                  ? nothingChanged
                    ? t('warehouseWarehouseFormPanel.noChanges')
                    : t('warehouseWarehouseFormPanel.saveChanges')
                  : t('warehouseWarehouseFormPanel.createWarehouse')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="wh-stack">
          <p className="wh-note">
            {isEdit
              ? t('warehouseWarehouseFormPanel.theCodeIsFixedSettings')
              : t('warehouseWarehouseFormPanel.aNewBuildingStartsWith')}
          </p>

          {error !== null && (
            <div role="alert" className="wh-alert">
              {error}
            </div>
          )}

          <TextField
            label={t('warehouseWarehouseFormPanel.code')}
            requiredMark={!isEdit}
            inputClassName="sk-ident"
            hint={
              isEdit
                ? t('warehouseWarehouseFormPanel.immutableTheNaturalKeyOther')
                : t('warehouseWarehouseFormPanel.uppercaseLettersDigitsAndDashes')
            }
            error={
              !isEdit && trimmedCode !== '' && codeBad
                ? t('warehouseWarehouseFormPanel.uppercaseAZ09')
                : undefined
            }
            value={isEdit ? warehouse.code : code}
            disabled={isEdit}
            maxLength={32}
            placeholder="CCU-01"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />

          <TextField
            label={t('warehouseWarehouseFormPanel.name')}
            requiredMark
            hint={t('warehouseWarehouseFormPanel.whatPeopleCallTheBuilding')}
            value={name}
            maxLength={120}
            showCount
            placeholder={t('warehouseWarehouseFormPanel.bangaloreFulfilmentCentre')}
            onChange={(e) => setName(e.target.value)}
          />

          <Select
            label={t('warehouseWarehouseFormPanel.status')}
            hint={t('warehouseWarehouseFormPanel.onlyActiveWarehousesAreOffered')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES(t).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>

          <div className="wh-fields" data-cols="2">
            <TextField
              label={t('warehouseWarehouseFormPanel.country')}
              hint={t('warehouseWarehouseFormPanel.isoTwoLetterCode')}
              error={
                cc !== '' && ccBad ? t('warehouseWarehouseFormPanel.exactlyTwoLetters') : undefined
              }
              value={countryCode}
              maxLength={2}
              placeholder="IN"
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            />

            <Select
              label={t('warehouseWarehouseFormPanel.timezone')}
              hint={t('warehouseWarehouseFormPanel.drivesTheLocalHourOn')}
              value={trimmedTz}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>

          <div className="wh-stack wh-stack--tight">
            <div className="wh-scan__label">
              {t('warehouseWarehouseFormPanel.shipsCustomerOrders')}
            </div>
            <Checkbox
              checked={fulfilsOrders}
              onChange={(e) => setFulfilsOrders(e.target.checked)}
              label={
                fulfilsOrders
                  ? t('warehouseWarehouseFormPanel.ordersCanShipFromHere')
                  : t('warehouseWarehouseFormPanel.intakeOnlyStockHereIs')
              }
              description={t('warehouseWarehouseFormPanel.leaveThisOnForA')}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
