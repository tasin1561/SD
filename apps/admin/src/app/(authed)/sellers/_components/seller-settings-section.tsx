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
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

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
      client.request<readonly ResolvedSetting[]>(`/admin/sellers/${sellerId}/settings`),
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
      client.request<unknown>(`/admin/sellers/${sellerId}/settings/${key}`, {
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
      client.request<unknown>(`/admin/sellers/${sellerId}/settings/${key}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-settings', sellerId] }),
  });
}

function render(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function SellerSettingsSection({ sellerId }: { readonly sellerId: string }): ReactElement {
  const list = useSellerSettings(sellerId);
  const clear = useClearOverride(sellerId);
  const [editing, setEditing] = useState<ResolvedSetting | null>(null);

  const items = list.data ?? [];
  const overridden = items.filter((s) => s.source === 'SELLER_OVERRIDE');

  return (
    <Section
      title="Settings for this seller"
      subtitle={
        overridden.length === 0
          ? 'Everything is on the system default.'
          : `${overridden.length} of ${items.length} keys are overridden for this seller.`
      }
    >
      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={4} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing overridable"
            description="A key becomes settable per seller when it is marked seller-overridable in system settings."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Setting</Th>
                <Th>In effect</Th>
                <Th>System default</Th>
                <Th>Source</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {items.map((s) => (
                <Tr key={s.key}>
                  <Td>
                    <code className="text-xs">{s.key}</code>
                  </Td>
                  <Td>{render(s.value)}</Td>
                  <Td>
                    <span className="text-text-faint">{render(s.systemDefault)}</span>
                  </Td>
                  <Td>
                    <StatusBadge
                      kind={s.source === 'SELLER_OVERRIDE' ? 'confirmed' : 'draft'}
                      label={s.source === 'SELLER_OVERRIDE' ? 'override' : 'default'}
                    />
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        {s.source === 'SELLER_OVERRIDE' ? 'Change' : 'Override'}
                      </Button>
                      {s.source === 'SELLER_OVERRIDE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={clear.isPending}
                          onClick={() => clear.mutate({ key: s.key })}
                        >
                          Reset
                        </Button>
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {clear.error !== null && <ErrorNote message={serverVerdict(clear.error)} />}

      <OverrideDialog sellerId={sellerId} setting={editing} onClose={() => setEditing(null)} />
    </Section>
  );
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

  const current = setting === null ? '' : render(setting.value);

  return (
    <Modal
      open={setting !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Override for this seller"
      description={
        setting === null ? undefined : (
          <span>
            <code className="text-xs">{setting.key}</code> — currently {current} (
            {setting.source === 'SELLER_OVERRIDE' ? 'overridden' : 'system default'})
          </span>
        )
      }
    >
      {setting !== null && (
        <>
          {setting.valueType === 'BOOLEAN' ? (
            <FormField label="Value" htmlFor="ov-value">
              <Select id="ov-value" value={raw} onChange={(e) => setRaw(e.target.value)}>
                <option value="">Choose…</option>
                <option value="true">yes</option>
                <option value="false">no</option>
              </Select>
            </FormField>
          ) : setting.valueType === 'JSON' ? (
            <FormField label="Value (JSON)" htmlFor="ov-value">
              <Textarea
                id="ov-value"
                rows={4}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </FormField>
          ) : (
            <FormField
              label={`Value (${setting.valueType.toLowerCase()})`}
              htmlFor="ov-value"
              hint="Allowed range is enforced when you save — the server has the authoritative bounds."
            >
              <Input
                id="ov-value"
                type={setting.valueType === 'STRING' ? 'text' : 'number'}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </FormField>
          )}

          <FormField label="Note" htmlFor="ov-note" hint="Optional. Why this seller is different.">
            <Input id="ov-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>

          {parseError !== null && <ErrorNote message={parseError} />}
          {save.error !== null && <ErrorNote message={serverVerdict(save.error)} />}
        </>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
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
        >
          {save.isPending ? 'Saving…' : 'Set override'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
