'use client';

import { useState, type ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  const [fields, setFields] = useState<readonly CredField[]>([
    { key: 0, name: 'apiToken', value: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setCourierCode('delhivery');
    setEnvironment(CredentialEnvironment.PRODUCTION);
    setLabel('');
    setNotes('');
    setIsDefault(false);
    setPickupLocationName('');
    setFields([{ key: 0, name: 'apiToken', value: '' }]);
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
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      size="md"
      title="Add a courier account"
      description="Credentials are encrypted at rest with a key held in the environment. They are never returned by any endpoint, so keep your own copy."
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Courier code" htmlFor="ca-courier" required>
            <Input
              id="ca-courier"
              value={courierCode}
              onChange={(e) => setCourierCode(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <FormField label="Environment" htmlFor="ca-env" required>
            <Select
              id="ca-env"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              {Object.values(CredentialEnvironment).map((env) => (
                <option key={env} value={env}>
                  {env.toLowerCase()}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          label="Label"
          htmlFor="ca-label"
          hint="How an operator will tell this account apart from the others."
          required
        >
          <Input
            id="ca-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Delhivery — primary"
            autoComplete="off"
          />
        </FormField>

        {credentialless && (
          <div className="border-border text-text-muted rounded-[10px] border border-dashed p-3 text-xs">
            A manual courier has no API, so there is nothing to authenticate — this account exists
            so its payouts can be recorded and settled like any other.
          </div>
        )}

        {/* ── credentials ── */}
        <div className={credentialless ? 'hidden' : 'border-border border-t pt-3'}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Credentials
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFields((prev) => [
                  ...prev,
                  { key: (prev.at(-1)?.key ?? 0) + 1, name: '', value: '' },
                ])
              }
            >
              <Plus size={13} aria-hidden /> Add field
            </Button>
          </div>

          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <Input
                  aria-label="Credential field name"
                  value={f.name}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="apiToken"
                  autoComplete="off"
                  className="w-44"
                />
                <Input
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
                  className="flex-1"
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
                  className="text-text-faint hover:text-[var(--color-critical)] disabled:opacity-30 shrink-0 rounded-[4px] p-1.5 transition-colors"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="text-text-body flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Make this the default for its courier and environment
            <span className="text-text-faint block text-xs">
              Sellers with no explicit link route here. At most one default per pair.
            </span>
          </span>
        </label>

        <FormField
          label="Pickup location name"
          htmlFor="ca-pickup"
          hint="The warehouse name registered with THIS account at Delhivery. Blank uses the global setting — fine for one account, wrong as soon as there are two."
          error={
            pickupLocationName !== pickupLocationName.trim() && pickupLocationName !== ''
              ? 'Leading or trailing space. Delhivery matches this exactly, so this would not match the registration.'
              : undefined
          }
        >
          <Input
            id="ca-pickup"
            value={pickupLocationName}
            onChange={(e) => setPickupLocationName(e.target.value)}
          />
        </FormField>

        <FormField label="Notes" htmlFor="ca-notes" hint="Optional.">
          <Textarea
            id="ca-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={
            courierCode.trim() === '' ||
            label.trim() === '' ||
            (!credentialless && filled.length === 0) ||
            create.isPending
          }
          onClick={() => void submit()}
        >
          {create.isPending ? 'Adding…' : 'Add account'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
