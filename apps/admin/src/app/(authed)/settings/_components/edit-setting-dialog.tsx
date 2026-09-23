'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Eye, EyeOff, Settings2 } from 'lucide-react';
import { SettingValueType } from '@skydrop/db';
import { serverVerdict } from '@/lib/server-verdict';
import { useSystemSetting, useUpdateSystemSetting } from '@/lib/api-hooks';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { AcAlert, AcFact, phaseOf } from './ac-parts';
import { FEE_CURRENCY_OPTIONS, isFeeCurrencyKey } from '@/lib/fee-currency';
import { usePermission } from '@/lib/use-permission';

/**
 * Edit a system setting. The modal renders a type-appropriate input:
 *   - STRING / INT / DECIMAL → text or number input
 *   - BOOLEAN → checkbox
 *   - JSON → textarea (parsed before submit)
 *   - DATE → datetime-local
 *
 * Sensitive settings start MASKED; the operator must click "Show
 * value" to reveal. The server still returns the raw value (UI is
 * the reveal-on-intent gate).
 *
 * FE-2: on update failure, the server's [code] message surfaces
 * VERBATIM (the server validates valueType + value per
 * SystemSettingsService.parseValue).
 */
export function EditSettingDialog({
  settingKey,
  onClose,
}: {
  settingKey: string;
  onClose: () => void;
}): ReactElement {
  const canWrite = usePermission('system.settings.manage');
  const detail = useSystemSetting(settingKey);
  const update = useUpdateSystemSetting(settingKey);

  const [draft, setDraft] = useState<string>('');
  const [boolDraft, setBoolDraft] = useState<boolean>(false);
  const [reveal, setReveal] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Seed the draft once the detail loads (or when the key changes).
  useEffect(() => {
    if (!detail.data) return;
    const raw = detail.data.value;
    if (detail.data.valueType === SettingValueType.BOOLEAN) {
      setBoolDraft(Boolean(raw));
    } else if (raw === null || raw === undefined) {
      setDraft('');
    } else if (detail.data.valueType === SettingValueType.JSON) {
      setDraft(JSON.stringify(raw, null, 2));
    } else if (raw instanceof Date) {
      // Date came through as ISO from JSON; defensive narrowing.
      setDraft(raw.toISOString());
    } else {
      setDraft(String(raw));
    }
  }, [detail.data]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setServerError(null);
    if (!detail.data) return;
    let parsed: unknown;
    try {
      parsed = clientParse(detail.data.valueType, draft, boolDraft);
    } catch (err) {
      // Client-side parse failure on JSON is informational — the
      // server would also reject. Surface a friendly hint here while
      // still preserving the FE-2 contract for the server side.
      setServerError(`[CLIENT_PARSE] ${err instanceof Error ? err.message : 'invalid value'}`);
      return;
    }
    try {
      await update.mutateAsync({ valueType: detail.data.valueType, value: parsed });
      onClose();
    } catch (err) {
      setServerError(serverVerdict(err, 'Update failed. Please try again.'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={detail.data?.displayName ?? settingKey}
      icon={<Settings2 size={18} />}
      locked={update.isPending}
      description={
        detail.data ? (
          <span className="ac-inline">
            <span className="sk-ident ac-code">{detail.data.key}</span>
            {detail.data.requiresRestart && <AcFact tone="bad">Restart required</AcFact>}
          </span>
        ) : undefined
      }
      size="md"
    >
      {detail.isLoading ? (
        <SkeletonRows rows={3} cols={1} />
      ) : !detail.data ? (
        <p className="ac-muted">Setting not found.</p>
      ) : (
        <form onSubmit={handleSubmit} className="ac-form">
          {detail.data.helpText && <p className="ac-muted">{detail.data.helpText}</p>}

          {detail.data.valueType === SettingValueType.BOOLEAN ? (
            <fieldset className="ac-fieldset">
              <legend>Value</legend>
              <Checkbox
                label={boolDraft ? 'true' : 'false'}
                checked={boolDraft}
                onChange={(e) => setBoolDraft(e.target.checked)}
                disabled={update.isPending || !canWrite}
              />
            </fieldset>
          ) : detail.data.valueType === SettingValueType.JSON ? (
            <TextArea
              label="Value (JSON)"
              hint="Must parse as a JSON object or array."
              rows={8}
              value={detail.data.isSensitive && !reveal ? '••••••••' : draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={update.isPending || (detail.data.isSensitive && !reveal)}
            />
          ) : isFeeCurrencyKey(detail.data.key) ? (
            <Select
              label="Currency"
              hint="The currency this fee is AGREED in. A non-INR fee is converted to rupees at the rate in force when the charge is taken."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={update.isPending}
            >
              {FEE_CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          ) : (
            <TextField
              label="Value"
              hint={typeHint(detail.data.valueType)}
              type={inputTypeFor(detail.data.valueType)}
              floatLabel={inputTypeFor(detail.data.valueType) === 'datetime-local'}
              value={detail.data.isSensitive && !reveal ? '••••••••' : draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={update.isPending || (detail.data.isSensitive && !reveal)}
            />
          )}

          {detail.data.isSensitive && (
            <div className="ac-buttons" data-align="start">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                onClick={() => setReveal((r) => !r)}
                disabled={update.isPending}
              >
                {reveal ? 'Mask' : 'Show value'}
              </Button>
            </div>
          )}

          {serverError && <AcAlert message={serverError} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              variant="primary"
              state={phaseOf(update.isPending, serverError)}
              labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
            />
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

function clientParse(type: SettingValueType, draft: string, boolDraft: boolean): unknown {
  switch (type) {
    case SettingValueType.STRING:
      return draft;
    case SettingValueType.INT: {
      if (!/^-?\d+$/.test(draft.trim())) {
        throw new Error('expected an integer');
      }
      return Number(draft.trim());
    }
    case SettingValueType.DECIMAL: {
      const trimmed = draft.trim();
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error('expected a decimal');
      }
      return trimmed;
    }
    case SettingValueType.BOOLEAN:
      return boolDraft;
    case SettingValueType.JSON: {
      try {
        const parsed: unknown = JSON.parse(draft);
        if (parsed === null || typeof parsed !== 'object') {
          throw new Error('expected an object or array');
        }
        return parsed;
      } catch (err) {
        throw new Error(`invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`);
      }
    }
    case SettingValueType.DATE: {
      const d = new Date(draft);
      if (Number.isNaN(d.getTime())) throw new Error('expected an ISO-8601 date');
      return d.toISOString();
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled valueType: ${String(exhaustive)}`);
    }
  }
}

function inputTypeFor(type: SettingValueType): string {
  switch (type) {
    case SettingValueType.INT:
    case SettingValueType.DECIMAL:
      return 'text'; // 'number' rejects leading zeros etc — text + parse is safer
    case SettingValueType.DATE:
      return 'datetime-local';
    default:
      return 'text';
  }
}

function typeHint(type: SettingValueType): string {
  switch (type) {
    case SettingValueType.INT:
      return 'Integer';
    case SettingValueType.DECIMAL:
      return 'Decimal (e.g., 18.00)';
    case SettingValueType.DATE:
      return 'ISO-8601 (YYYY-MM-DDTHH:mm:ss)';
    case SettingValueType.STRING:
    default:
      return 'Plain text';
  }
}
