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
import { SettingName, compareByGuide } from '@/components/setting-guide-ui';
import { SETTING_GROUP_ORDER, settingGuide, settingValueLabel } from '@/lib/system-setting-guide';
import { AcFact, AcHeader, AcPage, AcSection } from './ac-parts';
import { EditSettingDialog } from './edit-setting-dialog';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Admin /settings — every system setting, grouped by what it is about.
 * Each row leads with a plain-English name from `system-setting-guide`
 * (the same words a seller's override table shows), an (i) that says
 * what it decides with an example, and the key underneath for searching.
 * Values read as words where the guide knows them (On/Off, a choice's
 * name); a sensitive value stays masked exactly as the server sent it.
 * "Edit" opens the type-aware dialog.
 *
 * Grouped by the guide's groups rather than the raw `category` column:
 * `ops` and `courier` each held forty-odd unrelated settings. A key the
 * guide does not know yet lands under its category's name, last.
 *
 * FE-2 discipline: the dialog surfaces the server's [code] message
 * verbatim on validation errors. The list reflects the server's
 * authoritative valueDisplay (masked for sensitive).
 */
export function SettingsIndex(): ReactElement {
  const t = useT();

  const list = useSystemSettingsList();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <AcPage>
      <AcHeader
        title={t('settingsSettingsIndex.systemSettings')}
        subtitle={t('settingsSettingsIndex.howTheWholeSystemBehaves')}
      />

      {list.isLoading ? (
        <SkeletonRows rows={8} cols={3} label={t('settingsSettingsIndex.loadingSettings')} />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? t('settingsSettingsIndex.failedToLoadSettings')}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState
          title={t('settingsSettingsIndex.noSettings')}
          description={t('settingsSettingsIndex.theSeedShouldProvisionThese')}
        />
      ) : (
        groupByGuide(
          t,
          list.data.flatMap((g) => g.items),
        ).map((group) => (
          <AcSection
            key={group.title}
            title={group.title}
            note={`${group.items.length} ${group.items.length === 1 ? 'setting' : 'settings'}`}
            flush
          >
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

interface SettingGroupView {
  readonly title: string;
  readonly items: readonly SystemSettingView[];
}

/** The guide's groups in page order, then any unknown key under its category. */
function groupByGuide(
  t: Translate<MessageKey>,
  items: readonly SystemSettingView[],
): readonly SettingGroupView[] {
  const byTitle = new Map<string, SystemSettingView[]>();
  for (const s of [...items].sort((a, b) => compareByGuide(a.key, b.key))) {
    const title =
      settingGuide(s.key)?.group ??
      t('settingsSettingsIndex.other', { value: categoryLabel(s.category) });
    const bucket = byTitle.get(title);
    if (bucket === undefined) byTitle.set(title, [s]);
    else bucket.push(s);
  }
  const order = (title: string): number => {
    const i = (SETTING_GROUP_ORDER as readonly string[]).indexOf(title);
    return i === -1 ? SETTING_GROUP_ORDER.length : i;
  };
  return [...byTitle.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([title, groupItems]) => ({ title, items: groupItems }));
}

function SettingRow({
  setting,
  onEdit,
}: {
  setting: SystemSettingView;
  onEdit: () => void;
}): ReactElement {
  const t = useT();
  const shown = setting.isSensitive
    ? setting.valueDisplay
    : settingValueLabel(setting.key, setting.valueDisplay);
  return (
    <li className="ac-row">
      <div className="ac-row__main">
        <div className="ac-row__title">
          <SettingName settingKey={setting.key} />
          <StatusChip
            kind={valueTypeKind(setting.valueType)}
            label={setting.valueType.toLowerCase()}
            size="sm"
          />
          {setting.isSensitive && (
            <AcFact tone="warn">{t('settingsSettingsIndex.sensitive')}</AcFact>
          )}
          {setting.requiresRestart && (
            <AcFact tone="bad">{t('settingsSettingsIndex.restart')}</AcFact>
          )}
          {!setting.isEditableByAdmin && <AcFact>{t('settingsSettingsIndex.readOnly')}</AcFact>}
        </div>
        <div className="ac-row__value">{shown}</div>
        {setting.lastEditedAt && (
          <span className="ac-faint sk-figure">
            {t('settingsSettingsIndex.lastEdit', {
              value: new Date(setting.lastEditedAt).toISOString().replace('T', ' ').slice(0, 16),
            })}
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
          {t('settingsSettingsIndex.edit')}
        </Button>
      </div>
    </li>
  );
}

/**
 * Category keys whose DISPLAY name is not just the key title-cased.
 *
 * CON-2 renamed the words a person reads and deliberately left every KEY
 * alone, so `system_settings.category = 'reseller'` is still the right
 * key and "Reseller" is no longer the right heading — it would sit above
 * eight settings titled "Member store fraud signals…". A display map is
 * the fix rather than a migration: the key is an identifier the API and
 * the seed agree on, and renaming it to correct a heading would be the
 * tail wagging the dog.
 *
 * Note this is the one place a rename sweep could never have found. The
 * heading is DERIVED from the key below, not written as a string, so
 * there was nothing for a search for "Reseller" to match.
 */
const CATEGORY_LABELS: Record<string, string> = {
  reseller: 'Member stores',
};

function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category] ??
    category
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
  );
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
