'use client';

import { useState, type ReactElement } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, Table, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcAlert, AcSection } from '../../settings/_components/ac-parts';
import { serverVerdict } from '@/lib/server-verdict';
import {
  fallbackSettingName,
  parseList,
  settingGuide,
  settingValueLabel,
} from '@/lib/system-setting-guide';
import {
  SettingExplanation,
  SettingName,
  SettingValueEditor,
  compareByGuide,
  hasMultiChoice,
} from '@/components/setting-guide-ui';

/**
 * Per-seller setting overrides (SET-1).
 *
 * R0 built a generic mechanism so seller-specific behaviour would stop
 * accreting as nullable columns on `sellers` — and then nothing surfaced
 * it, so no override could be set through any interface. Every seller
 * ran on system defaults regardless of what was agreed with them.
 *
 * The screen shows every overridable key with its EFFECTIVE value and
 * where that value came from, because "what is this seller actually on"
 * is the question, and an override list alone answers only half of it.
 *
 * Clamping is enforced server-side at write time, not here (FE-2): if a
 * value is outside the key's allowed range the server refuses and its
 * verdict is shown verbatim. Mirroring the bounds client-side would be
 * a second copy of the policy to drift.
 *
 * Each row leads with a plain-English name from `system-setting-guide`
 * (the same words the global /settings page shows) and keeps the key
 * underneath for whoever needs to search for it; the (i) beside the name
 * says what the setting decides, with an example. A setting with known
 * choices is overridden from a list that says what each choice does.
 */

interface ResolvedSetting {
  key: string;
  valueType: string;
  value: unknown;
  source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  systemDefault: unknown;
}

function useSellerSettings(sellerId: string): UseQueryResult<readonly ResolvedSetting[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-settings', sellerId],
    queryFn: () =>
      client.request<readonly ResolvedSetting[]>(`/api/admin/sellers/${sellerId}/settings`),
  });
}

function useSetOverride(
  sellerId: string,
): UseMutationResult<
  unknown,
  Error,
  { key: string; valueType: string; value: unknown; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) =>
      client.request<unknown>(`/api/admin/sellers/${sellerId}/settings/${key}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-settings', sellerId] }),
  });
}

function useClearOverride(sellerId: string): UseMutationResult<unknown, Error, { key: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) =>
      client.request<unknown>(`/api/admin/sellers/${sellerId}/settings/${key}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-settings', sellerId] }),
  });
}

export function SellerSettingsSection({ sellerId }: { readonly sellerId: string }): ReactElement {
  const list = useSellerSettings(sellerId);
  const clear = useClearOverride(sellerId);
  const [editing, setEditing] = useState<ResolvedSetting | null>(null);

  const items = sortByGroup(list.data ?? []);
  const overridden = items.filter((s) => s.source === 'SELLER_OVERRIDE');

  return (
    <AcSection
      title="Settings for this seller"
      note={
        overridden.length === 0
          ? 'Everything is on the system default.'
          : `${overridden.length} of ${items.length} keys are overridden for this seller.`
      }
      flush
    >
      {list.isLoading ? (
        <SkeletonRows rows={4} />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          bare
          title="Nothing overridable"
          description="A key becomes settable per seller when it is marked seller-overridable in system settings."
        />
      ) : (
        <Table caption="Settings for this seller">
          <THead>
            <Tr>
              <Th>Setting</Th>
              <Th>In effect</Th>
              <Th>System default</Th>
              <Th>Source</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((s) => (
              <Tr key={s.key}>
                <Td>
                  <SettingName settingKey={s.key} showGroup />
                </Td>
                <Td>
                  <span className="ac-strong">{settingValueLabel(s.key, s.value)}</span>
                </Td>
                <Td>
                  <span className="ac-faint">{settingValueLabel(s.key, s.systemDefault)}</span>
                </Td>
                <Td>
                  <StatusChip
                    kind={s.source === 'SELLER_OVERRIDE' ? 'confirmed' : 'draft'}
                    label={s.source === 'SELLER_OVERRIDE' ? 'override' : 'default'}
                    size="sm"
                  />
                </Td>
                <Td align="right">
                  <div className="ac-buttons">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<SlidersHorizontal size={14} />}
                      onClick={() => setEditing(s)}
                    >
                      {s.source === 'SELLER_OVERRIDE' ? 'Change' : 'Override'}
                    </Button>
                    {s.source === 'SELLER_OVERRIDE' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw size={14} />}
                        disabled={clear.isPending}
                        onClick={() => clear.mutate({ key: s.key })}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {clear.error !== null && (
        <div className="ac-pad">
          <AcAlert message={serverVerdict(clear.error)} />
        </div>
      )}

      <OverrideDialog sellerId={sellerId} setting={editing} onClose={() => setEditing(null)} />
    </AcSection>
  );
}

/** Rows in the guide's group order, and within a group in the guide's own order. */
function sortByGroup(items: readonly ResolvedSetting[]): readonly ResolvedSetting[] {
  return [...items].sort((a, b) => compareByGuide(a.key, b.key));
}

function OverrideDialog({
  sellerId,
  setting,
  onClose,
}: {
  sellerId: string;
  setting: ResolvedSetting | null;
  onClose: () => void;
}): ReactElement {
  const save = useSetOverride(sellerId);
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  function close(): void {
    setRaw('');
    setNote('');
    setParseError(null);
    save.reset();
    onClose();
  }

  /** Turn the typed text into the shape the key's type expects. */
  function parsed(): unknown {
    if (setting === null) return null;
    switch (setting.valueType) {
      case 'INT':
        return Number.parseInt(raw, 10);
      case 'DECIMAL':
        return Number.parseFloat(raw);
      case 'BOOLEAN':
        return raw === 'true';
      case 'JSON':
        return JSON.parse(raw);
      default:
        return raw;
    }
  }

  const current = setting === null ? '' : settingValueLabel(setting.key, setting.value);
  const guide = setting === null ? null : settingGuide(setting.key);
  const currentCode =
    setting === null || setting.value === null || setting.value === undefined
      ? ''
      : String(setting.value);

  return (
    <Dialog
      open={setting !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        setting === null
          ? 'Override for this seller'
          : `${guide?.name ?? fallbackSettingName(setting.key)} — this seller`
      }
      icon={<SlidersHorizontal size={18} />}
      locked={save.isPending}
      description={
        setting === null ? undefined : (
          <span>
            Currently <strong>{current}</strong> (
            {setting.source === 'SELLER_OVERRIDE' ? 'set for this seller' : 'the system default'}).{' '}
            <code className="sk-ident">{setting.key}</code>
          </span>
        )
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            size="md"
            state={save.isPending ? 'busy' : save.error !== null ? 'error' : 'idle'}
            labels={{ idle: 'Set override', busy: 'Saving…', error: 'Not saved' }}
            disabled={raw === '' || save.isPending}
            onClick={() => {
              if (setting === null) return;
              setParseError(null);
              let value: unknown;
              try {
                value = parsed();
              } catch {
                setParseError('That is not valid JSON.');
                return;
              }
              if (typeof value === 'number' && Number.isNaN(value)) {
                setParseError('That is not a number.');
                return;
              }
              save.mutate(
                {
                  key: setting.key,
                  valueType: setting.valueType,
                  value,
                  ...(note.trim() === '' ? {} : { note: note.trim() }),
                },
                { onSuccess: close },
              );
            }}
          />
        </DialogFooter>
      }
    >
      {setting !== null && (
        <div className="ac-form">
          {guide !== null && <SettingExplanation guide={guide} />}
          <SettingValueEditor
            settingKey={setting.key}
            valueType={setting.valueType}
            value={
              raw === '' && hasMultiChoice(setting.key, setting.valueType)
                ? JSON.stringify(multiValue(setting.value))
                : raw
            }
            onChange={setRaw}
            placeholder="Choose…"
            keepValues={[currentCode]}
            numberHint="Allowed range is enforced when you save — the server has the authoritative bounds."
          />

          <TextField
            label="Note"
            id="ov-note"
            hint="Optional. Why this seller is different."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {parseError !== null && <AcAlert message={parseError} />}
          {save.error !== null && <AcAlert message={serverVerdict(save.error)} />}
        </div>
      )}
    </Dialog>
  );
}

/** The list a JSON pick-list setting holds now, or none. */
function multiValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value === 'string') return parseList(value) ?? [];
  return [];
}
