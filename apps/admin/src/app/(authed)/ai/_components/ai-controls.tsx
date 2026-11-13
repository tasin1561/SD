'use client';

import { useState, type ReactElement } from 'react';
import { Power } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { Switch } from '@skydrop/ui/app/switch';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';
import { serverVerdict } from '@/lib/server-verdict';
import { AcCard, AcSection } from '../../settings/_components/ac-parts';
import { useAiControls, useSetControl, type ControlValue } from '../_lib/ai-hooks';
import { usd } from '../_lib/ai-format';

/** `ai.ctl.<setting key>` (and `.note`): the catalogue holds one name and one sentence per control. */
const ctlKey = (k: string, note = false): MessageKey =>
  `ai.ctl.${k}${note ? '.note' : ''}` as MessageKey;

const SWITCHES = [
  'assistant.portal_staff_enabled',
  'assistant.portal_seller_enabled',
  'assistant.portal_store_enabled',
  'assistant.portal_associate_enabled',
  'assistant.attachments_enabled',
  'assistant.monitor_enabled',
  'assistant.public_enabled',
] as const;

const NUMBERS: ReadonlyArray<{ key: string; money: boolean }> = [
  { key: 'assistant.monthly_budget_usd', money: true },
  { key: 'assistant.daily_messages_per_user', money: false },
  { key: 'assistant.monitor_monthly_budget_usd', money: true },
  { key: 'assistant.public_monthly_budget_usd', money: true },
];

function NumberRow({
  k,
  money,
  current,
  busy,
  onSave,
}: {
  readonly k: string;
  readonly money: boolean;
  readonly current: ControlValue | undefined;
  readonly busy: boolean;
  readonly onSave: (v: number) => void;
}): ReactElement {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(current ?? '');
  const n = Number(shown);
  const valid =
    shown.trim() !== '' && Number.isFinite(n) && n >= 0 && (money || Number.isInteger(n));
  return (
    <div className="ai-ctl">
      <div className="ai-ctl__text">
        <strong>{t(ctlKey(k))}</strong>
        <span>{t(ctlKey(k, true))}</span>
        {money && current != null && (
          <small>{t('ai.ctl.now', { value: usd(String(current)) })}</small>
        )}
      </div>
      <div className="ai-ctl__edit">
        <TextField
          aria-label={t(ctlKey(k))}
          inputMode="decimal"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          size="sm"
          loading={busy}
          disabled={!valid || draft === null || draft === String(current ?? '')}
          onClick={() => {
            onSave(n);
            setDraft(null);
          }}
        >
          {t('ai.ctl.save')}
        </Button>
      </div>
    </div>
  );
}

/** Switches and limits. Each change goes through the settings service (audited) and takes effect on the next message. */
export function AiControls(): ReactElement {
  const t = useT();
  const toast = useToast();
  const q = useAiControls();
  const set = useSetControl();
  const [confirmOff, setConfirmOff] = useState(false);
  const s = q.data?.settings;

  const apply = (key: string, value: boolean | number | string): void => {
    set.mutate(
      { key, value },
      {
        onSuccess: () => toast.success(t('ai.ctl.saved')),
        onError: (e) => toast.error(serverVerdict(e)),
      },
    );
  };

  if (q.isError) return <ErrorState title={t('ai.error')} message={serverVerdict(q.error)} />;
  if (s === undefined) return <Skeleton height={320} />;
  const on = s['assistant.enabled'] !== false;

  return (
    <>
      <AcCard tone={on ? undefined : 'critical'}>
        <div className="ai-kill" data-on={on ? '1' : '0'}>
          <span className="ai-kill__icon" aria-hidden>
            <Power size={22} />
          </span>
          <div className="ai-kill__text">
            <h3>{on ? t('ai.kill.on') : t('ai.kill.off')}</h3>
            <p>{on ? t('ai.kill.onNote') : t('ai.kill.offNote')}</p>
          </div>
          <Button
            variant={on ? 'destructive' : 'primary'}
            loading={set.isPending && set.variables?.key === 'assistant.enabled'}
            onClick={() => (on ? setConfirmOff(true) : apply('assistant.enabled', true))}
          >
            {on ? t('ai.kill.turnOff') : t('ai.kill.turnOn')}
          </Button>
        </div>
      </AcCard>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('ai.kill.confirmTitle')}
        entity={t('ai.title')}
        consequence={t('ai.kill.confirmBody')}
        confirmLabel={t('ai.kill.turnOff')}
        destructive
        focusSafe
        onConfirm={() => apply('assistant.enabled', false)}
      />

      <AcSection title={t('ai.ctl.switches')} note={t('ai.ctl.effect')}>
        <div className="ai-ctls">
          {SWITCHES.map((k) => (
            <Switch
              key={k}
              label={t(ctlKey(k))}
              description={t(ctlKey(k, true))}
              checked={s[k] === true}
              disabled={set.isPending && set.variables?.key === k}
              onCheckedChange={(v) => apply(k, v)}
              onText={t('ai.on')}
              offText={t('ai.off')}
            />
          ))}
        </div>
      </AcSection>

      <AcSection title={t('ai.ctl.limits')}>
        <div className="ai-ctls">
          {NUMBERS.map((n) => (
            <NumberRow
              key={n.key}
              k={n.key}
              money={n.money}
              current={s[n.key]}
              busy={set.isPending && set.variables?.key === n.key}
              onSave={(v) => apply(n.key, v)}
            />
          ))}
        </div>
      </AcSection>
    </>
  );
}
