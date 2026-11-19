'use client';

import { useState, type ReactElement } from 'react';
import { ArrowRight, Wand2 } from 'lucide-react';
import type { BulkFixApplyResult, BulkFixGroup } from '@skydrop/api-client';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { useApplyBulkFix } from '@/lib/pending-bulk-hooks';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import { InfoLabel } from '@/components/easy/about';
import { OrdSection } from '../../_components/orders-parts';

const OTHER = '__other__';

/**
 * "Fix in bulk": the same problem with the same bad value, fixed once.
 *
 * Each group comes from the server already counted and already carrying its
 * reason in the seller's words ("SKU 'Elite Collagen' not found") and up to
 * three suggestions. The person picks a suggestion or types a value, then
 * applies it to the group — or applies and imports the rows that come out
 * clean. Nothing here decides what a valid value is; each row is checked
 * again by the server and reported back one by one.
 *
 * Only rows still waiting are ever touched. The (i) says so.
 */
export function BulkFixPanel({
  groups,
  onApplied,
  onSelect,
}: {
  readonly groups: readonly BulkFixGroup[];
  readonly onApplied: (result: BulkFixApplyResult) => void;
  readonly onSelect: (rowIds: readonly string[]) => void;
}): ReactElement | null {
  const t = useT();
  if (groups.length === 0) return null;
  return (
    <OrdSection
      title={<InfoLabel label={t('orderPending.fixTitle')} info={t('orderPending.fixInfo')} />}
    >
      <ul className="pend-fix">
        {groups.map((g) => (
          <FixGroup
            key={`${g.field}\u0000${g.kind}\u0000${g.badValue}`}
            group={g}
            onApplied={onApplied}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </OrdSection>
  );
}

function FixGroup({
  group,
  onApplied,
  onSelect,
}: {
  readonly group: BulkFixGroup;
  readonly onApplied: (result: BulkFixApplyResult) => void;
  readonly onSelect: (rowIds: readonly string[]) => void;
}): ReactElement {
  const t = useT();
  const apply = useApplyBulkFix();
  const first = group.suggestions[0]?.value;
  const [choice, setChoice] = useState<string>(first ?? OTHER);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const toValue = choice === OTHER ? typed.trim() : choice;
  const n = group.rowCount;
  const applyLabel = n === 1 ? t('orderPending.fixApplyOne') : t('orderPending.fixApplyN', { n });

  async function run(importAfterFix: boolean): Promise<void> {
    setError(null);
    try {
      const res = await apply.mutateAsync({
        field: group.field,
        fromValue: group.badValue,
        toValue,
        rowIds: group.rowIds,
        ...(importAfterFix ? { importAfterFix: true } : {}),
      });
      onApplied(res);
    } catch (e) {
      setError(verdict(e, t));
      throw e;
    }
  }

  return (
    <li className="pend-fix__group">
      <div className="pend-fix__what">
        <span className="pend-fix__icon" aria-hidden>
          <Wand2 size={15} />
        </span>
        <div className="pend-fix__text">
          <span className="pend-fix__line">
            <strong className="sk-figure">
              {n === 1 ? t('orderPending.fixGroupOne') : t('orderPending.fixGroupN', { n })}
            </strong>
            <span className="pend-fix__dot" aria-hidden>
              ·
            </span>
            <span>{group.reason}</span>
          </span>
          <span className="pend-fix__now">
            {t('orderPending.fixNow', {
              value: group.badValue === '' ? t('orderPending.fixEmpty') : group.badValue,
            })}
          </span>
        </div>
      </div>

      <div className="pend-fix__to">
        <ArrowRight size={16} aria-hidden className="pend-fix__arrow" />
        {group.suggestions.length > 0 && (
          <Select
            label={t('orderPending.fixChangeTo')}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {group.suggestions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label === s.value ? s.value : `${s.label} (${s.value})`}
              </option>
            ))}
            <option value={OTHER}>{t('orderPending.fixOther')}</option>
          </Select>
        )}
        {choice === OTHER && (
          <TextField
            label={
              group.suggestions.length > 0
                ? t('orderPending.fixTyped')
                : t('orderPending.fixChangeTo')
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={500}
          />
        )}
      </div>

      {error !== null && (
        <p className="pend-fix__error" role="alert">
          {error}
        </p>
      )}

      <div className="pend-fix__actions">
        <Button
          variant="primary"
          size="sm"
          disabled={toValue === '' || apply.isPending}
          onClick={() => void run(false).catch(() => undefined)}
        >
          {apply.isPending && !asking ? t('orderPending.fixApplying') : applyLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={toValue === '' || apply.isPending}
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
        >
          {t('orderPending.fixApplyImport')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onSelect(group.rowIds)}>
          {t('orderPending.fixSelect')}
        </Button>
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('orderPending.fixApplyImportTitle', { n })}
        entity={`${group.reason} → ${toValue}`}
        consequence={t('orderPending.fixApplyImportConsequence')}
        confirmLabel={t('orderPending.fixApplyImport')}
        error={error}
        onConfirm={() => run(true)}
      />
    </li>
  );
}
