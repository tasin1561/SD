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
import { serverVerdict } from '@/lib/server-verdict';
import { SetCallout, SetFact } from '../../_components/settings-parts';

/**
 * The delivery fee a new order starts with.
 *
 * Worth being explicit about what this is NOT: it is not what Skydrop
 * charges to move the parcel. That is our price to the seller and it is
 * not theirs to set. This number is what THEY charge THEIR customer, it
 * is added to the collectable amount, and it feeds nothing else.
 */
export function OrderDefaultsPanel(): ReactElement {
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
      toast.success(`New orders will start at ₹${saved.amountInr} delivery.`);
    } catch (e) {
      setError(serverVerdict(e));
      throw e;
    }
  }

  return (
    <section className="set-section">
      <SectionHeading
        title="Delivery fee"
        /*
          The note says WHOSE figure this currently is. It is the one
          thing about the field that a glance cannot tell you: an
          inherited default and a number somebody chose look identical in
          the box.
        */
        note={
          current.data === undefined ? undefined : current.data.isOwnValue ? (
            <SetFact tone="accent">Your own figure</SetFact>
          ) : (
            <SetFact>Skydrop default</SetFact>
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
                label="Delivery fee charged to your customer (₹)"
                icon={<IndianRupee size={15} />}
                hint={
                  current.data?.isOwnValue === true
                    ? 'Your own figure. Pre-filled on every new order, and editable there.'
                    : 'Currently the Skydrop default. Set your own and new orders will start with it.'
                }
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!mayEdit}
                inputClassName="sk-figure"
              />
              <p className="set-muted">
                This is what you add to the customer&apos;s collectable amount. It is not what
                Skydrop charges you to deliver — that is separate and unaffected by this.
              </p>
              {mayEdit && (
                <div className="set-buttons" data-align="start">
                  <AsyncButton
                    variant="primary"
                    labels={{ idle: 'Save', busy: 'Saving…', done: 'Saved', error: 'Not saved' }}
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
