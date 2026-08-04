'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { SettingValueType } from '@skydrop/db';
import { ApiError } from '@skydrop/api-client';
import { useSystemSetting, useUpdateSystemSetting } from '@/lib/api-hooks';
import {
  Button,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Textarea,
} from '@skydrop/ui/components';
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
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const b = err.body as { code?: unknown; message?: unknown };
        const code = typeof b.code === 'string' ? b.code : (err.code ?? 'UPDATE_FAILED');
        const msg = typeof b.message === 'string' ? b.message : err.message;
        setServerError(`[${code}] ${msg}`);
      } else {
        setServerError('Update failed. Please try again.');
      }
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={detail.data?.displayName ?? settingKey}
      description={
        detail.data ? (
          <span>
            <span className="font-mono text-[11px]">{detail.data.key}</span>
            {detail.data.requiresRestart && (
              <span className="text-critical ml-2 uppercase text-[11px] tracking-wide">
                Restart required
              </span>
            )}
          </span>
        ) : undefined
      }
      size="md"
    >
      {detail.isLoading ? (
        <LoadingState />
      ) : !detail.data ? (
        <div className="text-text-muted text-sm">Setting not found.</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {detail.data.helpText && (
            <p className="text-text-muted text-xs">{detail.data.helpText}</p>
          )}

          {detail.data.valueType === SettingValueType.BOOLEAN ? (
            <FormField label="Value">
              <label className="inline-flex items-center gap-2 text-sm text-text-body">
                <input
                  type="checkbox"
                  checked={boolDraft}
                  onChange={(e) => setBoolDraft(e.target.checked)}
                  disabled={update.isPending || !canWrite}
                />
                <span>{boolDraft ? 'true' : 'false'}</span>
              </label>
            </FormField>
          ) : detail.data.valueType === SettingValueType.JSON ? (
            <FormField label="Value (JSON)" hint="Must parse as a JSON object or array.">
              <Textarea
                rows={8}
                value={detail.data.isSensitive && !reveal ? '••••••••' : draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={update.isPending || (detail.data.isSensitive && !reveal)}
                className="font-mono text-xs"
              />
            </FormField>
          ) : (
            <FormField label="Value" hint={typeHint(detail.data.valueType)} error={undefined}>
              <Input
                type={inputTypeFor(detail.data.valueType)}
                value={detail.data.isSensitive && !reveal ? '••••••••' : draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={update.isPending || (detail.data.isSensitive && !reveal)}
                className="font-mono"
              />
            </FormField>
          )}

          {detail.data.isSensitive && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setReveal((r) => !r)}
              disabled={update.isPending}
            >
              {reveal ? (
                <>
                  <EyeOff size={12} /> Mask
                </>
              ) : (
                <>
                  <Eye size={12} /> Show value
                </>
              )}
            </Button>
          )}

          {serverError && (
            <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
              {serverError}
            </div>
          )}

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
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
