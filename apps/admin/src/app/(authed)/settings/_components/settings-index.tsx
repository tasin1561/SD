'use client';

import { useState, type ReactElement } from 'react';
import { SettingValueType } from '@skydrop/db';
import type { SystemSettingView } from '@skydrop/api-client';
import { useSystemSettingsList } from '@/lib/api-hooks';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
} from '@skydrop/ui/components';
import { EditSettingDialog } from './edit-setting-dialog';

/**
 * Admin /settings — system settings list, grouped by category. Each
 * row shows displayName / valueDisplay / type / annotations
 * (Sensitive / Restart / Read-only). Clicking "Edit" opens the
 * type-aware modal.
 *
 * FE-2 discipline: the modal surfaces server's [code] message
 * verbatim on validation errors. The list reflects the server's
 * authoritative valueDisplay (masked for sensitive).
 */
export function SettingsIndex(): ReactElement {
  const list = useSystemSettingsList();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="System settings"
        subtitle="Runtime configuration — values consumed by the operational services. Edits audit MEDIUM with before/after."
      />

      {list.isLoading ? (
        <LoadingState label="Loading settings…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load settings.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState
          title="No settings"
          description="The seed should provision these — check the database."
        />
      ) : (
        list.data.map((group) => (
          <Section key={group.category} title={categoryLabel(group.category)}>
            <Card>
              <ol className="divide-y divide-border">
                {group.items.map((s) => (
                  <SettingRow
                    key={s.id}
                    setting={s}
                    onEdit={() => setEditingKey(s.key)}
                  />
                ))}
              </ol>
            </Card>
          </Section>
        ))
      )}

      {editingKey && (
        <EditSettingDialog
          settingKey={editingKey}
          onClose={() => setEditingKey(null)}
        />
      )}
    </div>
  );
}

function SettingRow({
  setting,
  onEdit,
}: {
  setting: SystemSettingView;
  onEdit: () => void;
}): ReactElement {
  return (
    <li className="px-4 py-3 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-bright text-sm font-medium">
            {setting.displayName}
          </span>
          <span className="text-text-faint font-mono text-[11px]">
            {setting.key}
          </span>
          <StatusBadge
            kind={valueTypeKind(setting.valueType)}
            label={setting.valueType.toLowerCase()}
          />
          {setting.isSensitive && (
            <span className="text-[11px] uppercase tracking-wide text-pending">
              Sensitive
            </span>
          )}
          {setting.requiresRestart && (
            <span className="text-[11px] uppercase tracking-wide text-critical">
              Restart
            </span>
          )}
          {!setting.isEditableByAdmin && (
            <span className="text-[11px] uppercase tracking-wide text-text-muted">
              Read-only
            </span>
          )}
        </div>
        {setting.description && (
          <div className="text-text-muted text-xs mt-0.5">
            {setting.description}
          </div>
        )}
        <div className="mt-1.5 text-text-body text-sm font-mono break-all">
          {setting.valueDisplay}
        </div>
        {setting.lastEditedAt && (
          <div className="text-text-faint text-[11px] mt-1 font-mono">
            Last edit: {new Date(setting.lastEditedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>
        )}
      </div>
      <div className="shrink-0">
        <Button onClick={onEdit} disabled={!setting.isEditableByAdmin}>
          Edit
        </Button>
      </div>
    </li>
  );
}

function categoryLabel(category: string): string {
  return category
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function valueTypeKind(
  type: SettingValueType,
): 'draft' | 'confirmed' | 'pending' | 'in-transit' {
  switch (type) {
    case SettingValueType.STRING:
      return 'draft';
    case SettingValueType.INT:
    case SettingValueType.DECIMAL:
      return 'confirmed';
    case SettingValueType.BOOLEAN:
      return 'pending';
    case SettingValueType.JSON:
    case SettingValueType.DATE:
      return 'in-transit';
    default:
      return 'draft';
  }
}
