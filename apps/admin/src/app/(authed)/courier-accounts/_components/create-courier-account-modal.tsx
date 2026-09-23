'use client';

import { useState, type ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from '@/app/(authed)/system/_components/af-parts';
import './courier-accounts.css';
import { CredentialEnvironment } from '@skydrop/db';
import { useCouriers, useCreateCourierAccount } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

interface CredField {
  readonly key: number;
  readonly name: string;
  readonly value: string;
}

/**
 * Add a courier account, including its credentials.
 *
 * The credential values are `type="password"` and `autoComplete="off"`:
 * they are typed once, sent once, and encrypted server-side. Nothing
 * reads them back — not this form, not any endpoint. Field NAMES are
 * audited on each decrypt; values never are.
 *
 * Defaults to Delhivery + production because that is the only live
 * integration; the fields stay editable so a second courier does not
 * need a code change here.
 */
/**
 * What each courier's adapter actually READS out of the credential.
 *
 * The field NAMES are load-bearing and free-form, which is a bad
 * combination: `ShiprocketHttpService` looks up `email` and `password`
 * by those exact keys, and a credential saved as `apiToken` fails
 * nowhere near here — it fails at the first booking, months later, with
 * "credentials must carry `email` and `password`". Typing the right name
 * is not something to leave to memory.
 *
 * An unlisted courier falls back to `apiToken`, which is a guess and
 * labelled as one on the form.
 */
const CREDENTIAL_SHAPES: Readonly<Record<string, readonly string[]>> = {
  delhivery: ['apiToken'],
  shiprocket: ['email', 'password'],
};

function fieldsFor(courierCode: string): CredField[] {
  const names = CREDENTIAL_SHAPES[courierCode.trim()] ?? ['apiToken'];
  return names.map((name, i) => ({ key: i, name, value: '' }));
}

export function CreateCourierAccountModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const create = useCreateCourierAccount();

  const [courierCode, setCourierCode] = useState('delhivery');
  const [environment, setEnvironment] = useState<string>(CredentialEnvironment.PRODUCTION);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [pickupLocationName, setPickupLocationName] = useState('');
  const [fields, setFields] = useState<readonly CredField[]>(fieldsFor('delhivery'));
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setCourierCode('delhivery');
    setEnvironment(CredentialEnvironment.PRODUCTION);
    setLabel('');
    setNotes('');
    setIsDefault(false);
    setPickupLocationName('');
    setFields(fieldsFor('delhivery'));
    setError(null);
  }

  const couriers = useCouriers();
  const filled = fields.filter((f) => f.name.trim() !== '' && f.value !== '');
  // A courier with no API has nothing to authenticate with, so the
  // credential block is not merely optional — it is meaningless, and
  // the server refuses fields sent for one. Driven off the courier list
  // rather than the string 'manual', so a second manual carrier
  // inherits this by being declared MANUAL.
  const selected = couriers.data?.find((c) => c.code === courierCode.trim());
  const credentialless = selected?.integrationType === 'MANUAL';

  async function submit(): Promise<void> {
    setError(null);
    try {
      await create.mutateAsync({
        courierCode: courierCode.trim(),
        environment,
        label: label.trim(),
        ...(credentialless
          ? {}
          : {
              credentialFields: Object.fromEntries(filled.map((f) => [f.name.trim(), f.value])),
            }),
        ...(isDefault ? { isDefault: true } : {}),
        // NOT trimmed. Delhivery matches this string exactly, so a
        // trailing space is a different name — and trimming it here
        // would send something other than what was registered. The
        // warning below is how the operator finds out instead.
        ...(pickupLocationName === '' ? {} : { pickupLocationName }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      toast.success('Courier account added.');
      // Clear immediately on success so the secrets do not sit in
      // component state behind a closed modal.
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      size="md"
      title="Add a courier account"
      description="Credentials are encrypted at rest with a key held in the environment. They are never returned by any endpoint, so keep your own copy."
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={create.isPending}
            disabled={
              courierCode.trim() === '' ||
              label.trim() === '' ||
              (!credentialless && filled.length === 0) ||
              create.isPending
            }
            onClick={() => void submit()}
          >
            Add account
          </Button>
        </DialogFooter>
      }
    >
      <div className="af-form">
        <div className="af-grid-2">
          <TextField
            id="ca-courier"
            label="Courier code"
            requiredMark
            value={courierCode}
            onChange={(e) => {
              const next = e.target.value;
              setCourierCode(next);
              // Re-seed the field NAMES for the courier just chosen.
              // Only when nothing has been typed yet: silently
              // discarding a password somebody pasted would be worse
              // than leaving them to rename a field.
              setFields((prev) => (prev.every((f) => f.value === '') ? fieldsFor(next) : prev));
            }}
            autoComplete="off"
          />

          <Select
            id="ca-env"
            label="Environment"
            requiredMark
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            {Object.values(CredentialEnvironment).map((env) => (
              <option key={env} value={env}>
                {env.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>

        <TextField
          id="ca-label"
          label="Label"
          requiredMark
          hint="How an operator will tell this account apart from the others."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Delhivery — primary"
          autoComplete="off"
        />

        {credentialless && (
          <Notice tone="info">
            <p>
              A manual courier has no API, so there is nothing to authenticate — this account exists
              so its payouts can be recorded and settled like any other.
            </p>
          </Notice>
        )}

        {/* ── credentials ── */}
        <div className={credentialless ? 'ca-hidden' : 'af-divider af-stack'}>
          <div className="af-row af-row--between">
            <h3 className="af-title">Credentials</h3>
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() =>
                setFields((prev) => [
                  ...prev,
                  { key: (prev.at(-1)?.key ?? 0) + 1, name: '', value: '' },
                ])
              }
            >
              Add field
            </Button>
          </div>

          <div className="af-stack af-stack--tight">
            {fields.map((f) => (
              <div key={f.key} className="af-cred-row">
                <TextField
                  label="Field name"
                  aria-label="Credential field name"
                  value={f.name}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="apiToken"
                  autoComplete="off"
                />
                <TextField
                  label="Value"
                  aria-label="Credential value"
                  type="password"
                  value={f.value}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((x) => (x.key === f.key ? { ...x, value: e.target.value } : x)),
                    )
                  }
                  placeholder="••••••••••••"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  aria-label="Remove this credential field"
                  onClick={() =>
                    setFields((prev) =>
                      prev.length === 1 ? prev : prev.filter((x) => x.key !== f.key),
                    )
                  }
                  disabled={fields.length === 1}
                  className="af-icon-btn"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Checkbox
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          label="Make this the default for its courier and environment"
          description="Sellers with no explicit link route here. At most one default per pair."
        />

        <TextField
          id="ca-pickup"
          label="Pickup location name"
          hint="The warehouse name registered with THIS account at Delhivery. Blank uses the global setting — fine for one account, wrong as soon as there are two."
          error={
            pickupLocationName !== pickupLocationName.trim() && pickupLocationName !== ''
              ? 'Leading or trailing space. Delhivery matches this exactly, so this would not match the registration.'
              : undefined
          }
          value={pickupLocationName}
          onChange={(e) => setPickupLocationName(e.target.value)}
        />

        <TextArea
          id="ca-notes"
          label="Notes"
          hint="Optional."
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error !== null && <ErrorState title="Not added" message={error} />}
      </div>
    </Dialog>
  );
}
