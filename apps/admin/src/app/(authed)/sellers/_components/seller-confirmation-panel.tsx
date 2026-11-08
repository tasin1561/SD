'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { PhoneCall, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton, type AsyncPhase } from '@skydrop/ui/app/async-button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Switch } from '@skydrop/ui/app/switch';
import { TextField } from '@skydrop/ui/app/text-field';
import { AcAlert } from '../../settings/_components/ac-parts';
import { serverVerdict } from '@/lib/server-verdict';
import { formatDateTime } from '@/i18n/format';
import { useLocale, useT } from '@/i18n/client';
import { useClearOverride, useSetOverride, type ResolvedSetting } from './seller-settings-hooks';
import './seller-confirmation-panel.css';

export const CALL_REQUIRED_KEY = 'ops.call_confirmation_required';
export const CALL_TTL_KEY = 'ops.call_auto_confirm_ttl_hours';

export function isConfirmationKey(key: string): boolean {
  return key === CALL_REQUIRED_KEY || key === CALL_TTL_KEY;
}

type Attribution =
  | { readonly kind: 'default' }
  | { readonly kind: 'staff' | 'client' | 'unknown'; readonly at: string | null };

/**
 * Who wrote the shared override row last. Admin and client write the SAME
 * row and the last writer wins, so this is what stops one silently undoing
 * the other. The newer of the two keys' rows is the "last" one; nothing is
 * inferred beyond what the API recorded.
 */
export function attributionOf(rows: readonly (ResolvedSetting | undefined)[]): Attribution {
  const overrides = rows.filter(
    (r): r is ResolvedSetting => r !== undefined && r.source === 'SELLER_OVERRIDE',
  );
  if (overrides.length === 0) return { kind: 'default' };
  const latest = [...overrides].sort(
    (a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '') || 0,
  )[0] as ResolvedSetting;
  const at = latest.updatedAt ?? null;
  // Only two writers exist for this row: a staff member (their id is
  // recorded) and the client (no staff id). `null` is the API saying so;
  // an ABSENT field means the API did not say, which stays "unknown".
  if (latest.setByStaffId) return { kind: 'staff', at };
  if (latest.setBySellerId || latest.setByStaffId === null) return { kind: 'client', at };
  return { kind: 'unknown', at };
}

function asBool(v: unknown): boolean {
  return v === false || v === 'false' ? false : true;
}

/**
 * Phone confirmation for ONE client: a switch, and — only while it is
 * off — how long their orders wait before they confirm themselves.
 *
 * It reads and writes through the generic per-client override endpoints
 * (the same ones the table below uses). The 1–168 bound is stated here as
 * help text and ENFORCED by the server (FE-2): a value outside it comes
 * back as the server's own `[CODE] message`, shown verbatim.
 */
export function ConfirmationCallsPanel({
  sellerId,
  settings,
}: {
  readonly sellerId: string;
  readonly settings: readonly ResolvedSetting[];
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const req = settings.find((s) => s.key === CALL_REQUIRED_KEY);
  const ttl = settings.find((s) => s.key === CALL_TTL_KEY);

  const serverOn = req === undefined ? true : asBool(req.value);
  const serverTtl = ttl?.value === undefined || ttl.value === null ? '24' : String(ttl.value);

  const [on, setOn] = useState(serverOn);
  const [ttlRaw, setTtlRaw] = useState(serverTtl);
  const [phase, setPhase] = useState<AsyncPhase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const save = useSetOverride(sellerId);
  const clear = useClearOverride(sellerId);

  // A refetch (after a save, or a client change elsewhere) is the truth.
  useEffect(() => {
    setOn(serverOn);
    setTtlRaw(serverTtl);
  }, [serverOn, serverTtl, req?.updatedAt, ttl?.updatedAt]);

  if (req === undefined) return null;

  const attr = attributionOf([req, ttl]);
  const dirty = on !== serverOn || (!on && ttlRaw !== serverTtl);
  const hasOverride = attr.kind !== 'default';
  const when = attr.kind !== 'default' && attr.at !== null ? formatDateTime(attr.at, locale) : null;

  async function onSave(): Promise<void> {
    setFailure(null);
    setParseError(null);
    let hours: number | null = null;
    if (!on) {
      hours = Number.parseInt(ttlRaw, 10);
      if (Number.isNaN(hours)) {
        setParseError(t('confirmCalls.notANumber'));
        setPhase('error');
        throw new Error('not a number');
      }
    }
    setPhase('busy');
    try {
      await save.mutateAsync({ key: CALL_REQUIRED_KEY, valueType: 'BOOLEAN', value: on });
      if (hours !== null) {
        await save.mutateAsync({ key: CALL_TTL_KEY, valueType: 'INT', value: hours });
      }
      setPhase('success');
    } catch (e) {
      setFailure(serverVerdict(e));
      setPhase('error');
      throw e;
    }
  }

  return (
    <div className="cc-panel" data-on={on ? '1' : '0'}>
      <div className="cc-panel__head">
        <span className="cc-panel__chip" aria-hidden>
          <PhoneCall size={18} />
        </span>
        <div className="cc-panel__titles">
          <h3 className="cc-panel__title">{t('confirmCalls.title')}</h3>
          <p className="cc-panel__note">{t('confirmCalls.note')}</p>
        </div>
        <StatusChip
          size="sm"
          kind={hasOverride ? 'confirmed' : 'draft'}
          label={hasOverride ? t('confirmCalls.sourceOverride') : t('confirmCalls.sourceDefault')}
        />
      </div>

      <p className="cc-panel__attr" data-kind={attr.kind}>
        {attr.kind === 'default'
          ? t('confirmCalls.attrDefault')
          : attr.kind === 'unknown'
            ? when === null
              ? t('confirmCalls.attrUnknown')
              : t('confirmCalls.attrUnknownAt', { when })
            : t(
                attr.kind === 'staff'
                  ? 'confirmCalls.attrByStaffAt'
                  : 'confirmCalls.attrByClientAt',
                {
                  when: when ?? '—',
                },
              )}
      </p>
      {attr.kind === 'client' && (
        <AcAlert tone="warn" message={t('confirmCalls.attrClientWarning')} />
      )}

      <div className="cc-panel__body">
        <Switch
          label={t('confirmCalls.switchLabel')}
          description={on ? t('confirmCalls.switchOnDesc') : t('confirmCalls.switchOffDesc')}
          onText={t('confirmCalls.on')}
          offText={t('confirmCalls.off')}
          checked={on}
          onCheckedChange={(next) => {
            setOn(next);
            setPhase('idle');
          }}
        />

        <div className="cc-panel__ttl">
          <TextField
            id="cc-ttl"
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            step={1}
            label={t('confirmCalls.ttlLabel')}
            hint={on ? t('confirmCalls.ttlHintOn') : t('confirmCalls.ttlHint')}
            disabled={on}
            value={ttlRaw}
            onChange={(e) => {
              setTtlRaw(e.target.value);
              setPhase('idle');
            }}
          />
        </div>
      </div>

      {!on && (
        <p className="cc-panel__rto">
          <ShieldAlert size={16} aria-hidden />
          <span>{t('confirmCalls.rtoWarning')}</span>
        </p>
      )}

      {parseError !== null && <AcAlert message={parseError} />}
      {failure !== null && <AcAlert message={failure} />}
      {clear.error !== null && <AcAlert message={serverVerdict(clear.error)} />}

      <div className="cc-panel__actions">
        <AsyncButton
          size="md"
          state={phase}
          labels={{
            idle: t('confirmCalls.save'),
            busy: t('confirmCalls.saving'),
            done: t('confirmCalls.saved'),
            error: t('confirmCalls.notSaved'),
          }}
          disabled={!dirty && phase !== 'error'}
          onClick={() => {
            void onSave().catch(() => undefined);
          }}
        />
        {hasOverride && (
          <Button
            variant="ghost"
            size="md"
            icon={<RotateCcw size={14} />}
            disabled={clear.isPending || phase === 'busy'}
            onClick={() => {
              setFailure(null);
              void Promise.all([
                req.source === 'SELLER_OVERRIDE'
                  ? clear.mutateAsync({ key: CALL_REQUIRED_KEY })
                  : null,
                ttl?.source === 'SELLER_OVERRIDE' ? clear.mutateAsync({ key: CALL_TTL_KEY }) : null,
              ]).catch(() => undefined);
            }}
          >
            {t('confirmCalls.resetToDefault')}
          </Button>
        )}
      </div>
    </div>
  );
}
