'use client';

import { useState, type ReactElement } from 'react';
import { SettingValueType } from '@skydrop/db';
import type { SystemSettingView } from '@skydrop/api-client';
import { useSystemSettingsList } from '@/lib/api-hooks';
import { PencilLine } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { AcFact, AcHeader, AcPage, AcSection } from './ac-parts';
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
    <AcPage>
      <AcHeader
        title="System settings"
        subtitle="Runtime configuration — values consumed by the operational services. Edits audit MEDIUM with before/after."
      />

      {list.isLoading ? (
        <SkeletonRows rows={8} cols={3} label="Loading settings…" />
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
          <AcSection key={group.category} title={categoryLabel(group.category)} flush>
            <ol className="ac-rows">
              {group.items.map((s) => (
                <SettingRow key={s.id} setting={s} onEdit={() => setEditingKey(s.key)} />
              ))}
            </ol>
          </AcSection>
        ))
      )}

      {editingKey && (
        <EditSettingDialog settingKey={editingKey} onClose={() => setEditingKey(null)} />
      )}
    </AcPage>
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
    <li className="ac-row">
      <div className="ac-row__main">
        <div className="ac-row__title">
          <span>{setting.displayName}</span>
          <StatusChip
            kind={valueTypeKind(setting.valueType)}
            label={setting.valueType.toLowerCase()}
            size="sm"
          />
          {setting.isSensitive && <AcFact tone="warn">Sensitive</AcFact>}
          {setting.requiresRestart && <AcFact tone="bad">Restart</AcFact>}
          {!setting.isEditableByAdmin && <AcFact>Read-only</AcFact>}
        </div>
        {/* A key like `courier.delhivery_pickup_location` is a single
            unbreakable token wider than a phone, so it wraps anywhere. */}
        <span className="sk-ident ac-code">{setting.key}</span>
        {setting.description && <span className="ac-muted">{setting.description}</span>}
        <div className="ac-row__value">{setting.valueDisplay}</div>
        {setting.lastEditedAt && (
          <span className="ac-faint sk-figure">
            Last edit: {new Date(setting.lastEditedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </div>
      <div className="ac-row__side">
        <Button
          variant="secondary"
          size="sm"
          icon={<PencilLine size={14} />}
          onClick={onEdit}
          disabled={!setting.isEditableByAdmin}
        >
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

function valueTypeKind(type: SettingValueType): 'draft' | 'confirmed' | 'pending' | 'in-transit' {
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
