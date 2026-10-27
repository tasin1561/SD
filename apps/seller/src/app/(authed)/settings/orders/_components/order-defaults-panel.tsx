'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { CircleAlert, IndianRupee } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { TextField } from '@skydrop/ui/app/text-field';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useCustomerDeliveryFee, useSetCustomerDeliveryFee } from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import { SetCallout, SetFact } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';

/**
 * The delivery fee a new order starts with.
 *
 * Worth being explicit about what this is NOT: it is not what Skydrop
 * charges to move the parcel. That is our price to the seller and it is
 * not theirs to set. This number is what THEY charge THEIR customer, it
 * is added to the collectable amount, and it feeds nothing else.
 */
export function OrderDefaultsPanel(): ReactElement {
  const t = useT();
  const toast = useToast();
  const mayEdit = can(useSellerIdentity(), 'orders.create');
  const current = useCustomerDeliveryFee();
  const save = useSetCustomerDeliveryFee();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current.data !== undefined) setValue(current.data.amountInr);
  }, [current.data]);

  // Rethrows after recording the verdict so the button shows the failure
  // on itself; nothing else calls this.
  async function onSave(): Promise<void> {
    setError(null);
    try {
      const saved = await save.mutateAsync({ amountInr: Number(value) });
      toast.success(t('settingsOrders.newOrdersWillStart', { amountInr: saved.amountInr }));
    } catch (e) {
      setError(verdict(e, t));
      throw e;
    }
  }

  return (
    <section className="set-section">
      <SectionHeading
        title={t('settingsOrders.deliveryFee')}
        /*
          The note says WHOSE figure this currently is. It is the one
          thing about the field that a glance cannot tell you: an
          inherited default and a number somebody chose look identical in
          the box.
        */
        note={
          current.data === undefined ? undefined : current.data.isOwnValue ? (
            <SetFact tone="accent">{t('settingsOrders.yourOwnFigure')}</SetFact>
          ) : (
            <SetFact>{t('settingsOrders.skydropDefault')}</SetFact>
          )
        }
      />
      <div className="set-card">
        {current.isLoading ? (
          <div className="set-skel-pair">
            <Skeleton width={260} height={40} />
            <Skeleton width={120} height={40} />
          </div>
        ) : (
          <>
            {error !== null && (
              <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                <p>{error}</p>
              </SetCallout>
            )}
            <div className="set-form-grid set-form-narrow">
              <TextField
                label={t('settingsOrders.deliveryFeeChargedTo')}
                icon={<IndianRupee size={15} />}
                hint={
                  current.data?.isOwnValue === true
                    ? t('settingsOrders.yourOwnFigurePre')
                    : t('settingsOrders.currentlyTheSkydropDefault')
                }
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!mayEdit}
                inputClassName="sk-figure"
              />
              <p className="set-muted">{t('settingsOrders.thisIsWhatYou')}</p>
              {mayEdit && (
                <div className="set-buttons" data-align="start">
                  <AsyncButton
                    variant="primary"
                    labels={{
                      idle: t('settingsOrders.save'),
                      busy: t('settingsOrders.saving'),
                      done: t('settingsOrders.saved'),
                      error: t('settingsOrders.notSaved'),
                    }}
                    disabled={save.isPending || value.trim() === ''}
                    onAction={onSave}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
