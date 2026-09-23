'use client';

import { useState, type ReactElement } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import './delhivery.css';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useDelhiveryConnectivity,
  useRegisterCourierWarehouse,
  useUpdateCourierWarehouse,
  type RegisterCourierWarehouseBody,
} from '@/lib/ops-hooks';

/**
 * The two things that have to be true before a real parcel can move,
 * and neither had a screen.
 *
 * ── 1. CAN WE REACH THEM AT ALL ──────────────────────────────────────
 * One live serviceability lookup with the stored credential. It creates
 * nothing, so it is safe to run before the first parcel — which is
 * exactly when somebody wants to know. `reachedLiveApi` is the only
 * field worth reading: a serviceability answer can be served from a
 * local ServiceArea row, and a cached "yes" looks identical to a
 * successful call while proving nothing.
 *
 * ── 2. IS OUR WAREHOUSE A PICKUP LOCATION ────────────────────────────
 * Every shipment create sends `pickup_location: { name }` and Delhivery
 * matches that string EXACTLY — case and spaces included. An
 * unregistered warehouse, or one whose name differs by a single
 * character, fails every AWB. The name cannot be changed afterwards; it
 * is the key the update path uses to say which location it means.
 *
 * So the name field is treated as the dangerous input it is: whitespace
 * is shown rather than silently trimmed (the server refuses it, and
 * being told at the field beats a round trip), and registering asks for
 * the name to be typed a second time. That is not ceremony — it is the
 * only irreversible field on the form.
 *
 * There is no "list my pickup locations" endpoint at Delhivery, so this
 * panel cannot show what is already registered, and it says so. The
 * record of what was sent is the audit log.
 */

const EMPTY: RegisterCourierWarehouseBody = {
  name: '',
  phone: '',
  pin: '',
  returnAddress: '',
};

export function AccountSetupPanel(): ReactElement | null {
  const toast = useToast();
  const mayProbe = usePermission('courier.ops.view');
  const mayRegister = usePermission('courier.accounts.manage');

  const probe = useDelhiveryConnectivity();
  const register = useRegisterCourierWarehouse();
  const update = useUpdateCourierWarehouse();

  const [pin, setPin] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'REGISTER' | 'UPDATE'>('REGISTER');
  const [form, setForm] = useState<RegisterCourierWarehouseBody>(EMPTY);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!mayProbe) return null;

  function set<K extends keyof RegisterCourierWarehouseBody>(
    k: K,
    v: RegisterCourierWarehouseBody[K],
  ): void {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openFor(next: 'REGISTER' | 'UPDATE'): void {
    setMode(next);
    setForm(EMPTY);
    setConfirmName('');
    setError(null);
    setOpen(true);
  }

  // Shown, not silently fixed: the server refuses a name that differs
  // from its own trimmed form, and quietly trimming here would hide the
  // fact that the string is load-bearing.
  const nameHasEdgeSpace = form.name !== form.name.trim() && form.name !== '';
  const nameOk = form.name.trim() !== '' && !nameHasEdgeSpace;
  const confirmed = mode === 'UPDATE' || confirmName === form.name;
  const complete =
    nameOk &&
    confirmed &&
    form.phone.trim() !== '' &&
    /^\d{6}$/.test(form.pin.trim()) &&
    form.returnAddress.trim() !== '';

  async function onProbe(): Promise<void> {
    setError(null);
    try {
      const r = await probe.mutateAsync(pin.trim() === '' ? {} : { pincode: pin.trim() });
      if (r.stubMode) {
        toast.info('Stub mode — nothing left the box. This proves nothing about the real account.');
      } else if (r.reachedLiveApi) {
        toast.success(
          `Reached Delhivery. ${r.pincode ?? ''} is ${r.detail?.serviceable === true ? 'serviceable' : 'not serviceable'}.`,
        );
      } else {
        toast.error(r.error ?? 'Did not reach the live API.');
      }
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    const body: RegisterCourierWarehouseBody = {
      name: form.name,
      phone: form.phone.trim(),
      pin: form.pin.trim(),
      returnAddress: form.returnAddress.trim(),
      // Omitted rather than sent blank — the API whitelists fields, and
      // an empty string is a value that would be stored as one.
      ...(form.address?.trim() ? { address: form.address.trim() } : {}),
      ...(form.city?.trim() ? { city: form.city.trim() } : {}),
      ...(form.email?.trim() ? { email: form.email.trim() } : {}),
      ...(form.registeredName?.trim() ? { registeredName: form.registeredName.trim() } : {}),
      ...(form.returnCity?.trim() ? { returnCity: form.returnCity.trim() } : {}),
      ...(form.returnPin?.trim() ? { returnPin: form.returnPin.trim() } : {}),
      ...(form.returnState?.trim() ? { returnState: form.returnState.trim() } : {}),
    };
    try {
      const r =
        mode === 'REGISTER' ? await register.mutateAsync(body) : await update.mutateAsync(body);
      setOpen(false);
      if (r.success) {
        toast.success(
          mode === 'REGISTER'
            ? `Registered "${r.name}". Every shipment from this warehouse must send exactly that name.`
            : `Updated "${r.name}".`,
        );
      } else {
        // A 200 that did not succeed is Delhivery declining, and its own
        // words are more useful than ours.
        setError(r.message ?? 'Delhivery declined the request without saying why.');
      }
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const result = probe.data;

  return (
    <AfSection
      title="Account setup"
      note="What has to be true before a real parcel can move. Neither of these creates a shipment."
    >
      {error !== null && !open && <ErrorState title="Refused" message={error} />}

      <div className="af-grid-2">
        <AfCard>
          <h3 className="af-card__title">Reachability</h3>
          <p className="af-muted">
            One live serviceability lookup using the stored credential. Creates nothing. In stub
            mode it reports that it did not reach anything — a cached answer would look exactly like
            proof.
          </p>
          <div className="af-row af-row--bottom">
            <div className="af-grow">
              <TextField
                label="Pincode"
                hint="Blank uses our own dispatch origin."
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="110001"
              />
            </div>
            <Button
              variant="secondary"
              size="md"
              loading={probe.isPending}
              onClick={() => void onProbe()}
            >
              Check connection
            </Button>
          </div>

          {result !== undefined && (
            <div className="af-body">
              {result.stubMode ? (
                <span>
                  Stub mode: the call never left the box. This says nothing about the real account.
                </span>
              ) : result.reachedLiveApi ? (
                <span>
                  Reached the live API. {result.pincode} —{' '}
                  {result.detail?.serviceable === true ? 'serviceable' : 'not serviceable'}
                  {result.detail?.city !== null && result.detail?.city !== undefined
                    ? `, ${result.detail.city}`
                    : ''}
                  .
                </span>
              ) : (
                <span className="af-bad">{result.error ?? 'Did not reach the live API.'}</span>
              )}
            </div>
          )}
        </AfCard>

        <AfCard>
          <h3 className="af-card__title">Pickup location</h3>
          <p className="af-muted">
            Every shipment sends this warehouse&apos;s name and Delhivery matches it exactly — case
            and spaces included. A warehouse that is not registered, or whose name differs by one
            character, fails every AWB. Delhivery offers no way to list what is already registered,
            so this cannot show you; the audit log is the record.
          </p>
          {mayRegister ? (
            <div className="af-row">
              <Button variant="primary" size="md" onClick={() => openFor('REGISTER')}>
                Register a warehouse
              </Button>
              <Button variant="secondary" size="md" onClick={() => openFor('UPDATE')}>
                Update a registered one
              </Button>
            </div>
          ) : (
            <p className="af-faint">Registering needs the courier-accounts permission.</p>
          )}
        </AfCard>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        size="lg"
        tone={mode === 'REGISTER' ? 'critical' : 'default'}
        title={mode === 'REGISTER' ? 'Register a pickup location' : 'Update a pickup location'}
        description={
          mode === 'REGISTER'
            ? 'The name cannot be changed afterwards, and it is what every shipment is matched on. Everything else can be corrected later.'
            : 'The name identifies which location to change, so it must match what was registered exactly. Everything else here replaces what is stored.'
        }
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={mode === 'REGISTER' ? 'destructive' : 'primary'}
              size="md"
              loading={register.isPending || update.isPending}
              disabled={!complete || register.isPending || update.isPending}
              onClick={() => void onSubmit()}
            >
              {mode === 'REGISTER' ? 'Register permanently' : 'Update'}
            </Button>
          </DialogFooter>
        }
      >
        <div className="af-form">
          {error !== null && <ErrorState title="Refused" message={error} />}
          <TextField
            label="Warehouse name"
            requiredMark
            hint="Exactly as it will be sent on every shipment."
            error={
              nameHasEdgeSpace
                ? 'This has a leading or trailing space. Delhivery would treat it as a different name — and it cannot be corrected.'
                : undefined
            }
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />

          {mode === 'REGISTER' && (
            <TextField
              label="Type the name again"
              requiredMark
              hint="It is the one field nobody can fix later."
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          )}

          <div className="af-grid-2">
            <TextField
              label="Phone"
              requiredMark
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
            <TextField
              label="Pincode"
              requiredMark
              hint="Six digits."
              inputMode="numeric"
              value={form.pin}
              onChange={(e) => set('pin', e.target.value)}
            />
          </div>

          <TextField
            label="Address"
            value={form.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
          />
          <div className="af-grid-2">
            <TextField
              label="City"
              value={form.city ?? ''}
              onChange={(e) => set('city', e.target.value)}
            />
            <TextField
              label="Email"
              value={form.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>

          <TextField
            label="Return address"
            requiredMark
            hint="Where undelivered parcels come back to. May be the same address."
            value={form.returnAddress}
            onChange={(e) => set('returnAddress', e.target.value)}
          />
          <div className="af-grid-3">
            <TextField
              label="Return city"
              value={form.returnCity ?? ''}
              onChange={(e) => set('returnCity', e.target.value)}
            />
            <TextField
              label="Return pincode"
              inputMode="numeric"
              value={form.returnPin ?? ''}
              onChange={(e) => set('returnPin', e.target.value)}
            />
            <TextField
              label="Return state"
              value={form.returnState ?? ''}
              onChange={(e) => set('returnState', e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </AfSection>
  );
}
