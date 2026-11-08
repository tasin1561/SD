'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { ArrowRight, CircleAlert, PhoneCall, Undo2 } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { TextField } from '@skydrop/ui/app/text-field';
import { Switch } from '@skydrop/ui/app/switch';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  TTL_MAX_HOURS,
  TTL_MIN_HOURS,
  useCallConfirmationSetting,
  useSetCallConfirmationSetting,
} from '@/lib/call-confirmation-hooks';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import { SetCallout } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';
import '../../../orders/awaiting-confirmation/_components/awaiting.css';

/**
 * Automatic confirmation calls: on (the default, and the safe state) or off
 * with a time limit.
 *
 * Off is a real trade, not a switch with a hidden cost: no agent phones the
 * customer, and a parcel that comes back is charged to the client at the usual
 * RTO fee. The sentence saying so is shown once, always, beside the switch —
 * stated as a fact to decide on, not as a warning.
 *
 * The 1–168 bound is stated before submitting. It is NOT enforced here: the
 * server clamps and is the authority (FE-2); the field is re-read from what it
 * stored after a save.
 */
export function CallConfirmationPanel(): ReactElement {
  const t = useT();
  const toast = useToast();
  const mayEdit = can(useSellerIdentity(), 'orders.create');
  const current = useCallConfirmationSetting();
  const save = useSetCallConfirmationSetting();

  const [required, setRequired] = useState(true);
  const [ttl, setTtl] = useState('24');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current.data === undefined) return;
    setRequired(current.data.callsRequired);
    setTtl(String(current.data.ttlHours));
  }, [current.data]);

  async function onSave(): Promise<void> {
    setError(null);
    try {
      await save.mutateAsync({ callsRequired: required, ttlHours: Number(ttl) });
      toast.success(t('callConfirm.savedToast'));
    } catch (e) {
      setError(verdict(e, t));
      throw e;
    }
  }

  const ttlInvalid = !required && (ttl.trim() === '' || Number.isNaN(Number(ttl)));

  return (
    <section className="set-section">
      <SectionHeading title={t('callConfirm.settingTitle')} />
      <div className="set-card">
        {current.isLoading ? (
          <div className="set-skel-pair">
            <Skeleton width={260} height={40} />
            <Skeleton width={120} height={40} />
          </div>
        ) : (
          <div className="cc-setting">
            {error !== null && (
              <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                <p>{error}</p>
              </SetCallout>
            )}
            <Switch
              checked={required}
              disabled={!mayEdit}
              onCheckedChange={setRequired}
              onText={t('callConfirm.on')}
              offText={t('callConfirm.off')}
              label={t('callConfirm.switchLabel')}
              description={t('callConfirm.switchDesc')}
            />
            <p className="cc-fact">
              <Undo2 size={15} aria-hidden />
              <span>{t('callConfirm.rtoFact')}</span>
            </p>
            <div className="set-form-narrow">
              <TextField
                label={t('callConfirm.ttlLabel')}
                icon={<PhoneCall size={15} />}
                hint={t('callConfirm.ttlHint', { min: TTL_MIN_HOURS, max: TTL_MAX_HOURS })}
                type="number"
                inputMode="numeric"
                min={TTL_MIN_HOURS}
                max={TTL_MAX_HOURS}
                step={1}
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
                disabled={!mayEdit || required}
                inputClassName="sk-figure"
              />
            </div>
            <div className="set-buttons" data-align="start">
              {mayEdit && (
                <AsyncButton
                  variant="primary"
                  labels={{
                    idle: t('callConfirm.save'),
                    busy: t('callConfirm.saving'),
                    done: t('callConfirm.saved'),
                    error: t('callConfirm.notSaved'),
                  }}
                  disabled={save.isPending || ttlInvalid}
                  onAction={onSave}
                />
              )}
              <Link href="/orders/awaiting-confirmation" className="cc-link">
                {t('callConfirm.openList')}
                <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
