'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  FormField,
  Input,
  LoadingState,
  useToast,
} from '@skydrop/ui/components';
import { useCustomerDeliveryFee, useSetCustomerDeliveryFee } from '@/lib/api-hooks';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';

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

  async function onSave(): Promise<void> {
    setError(null);
    try {
      const saved = await save.mutateAsync({ amountInr: Number(value) });
      toast.success(`New orders will start at ₹${saved.amountInr} delivery.`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  if (current.isLoading) return <LoadingState rows={2} />;

  return (
    <Card>
      <CardBody>
        {error !== null && (
          <div className="mb-3">
            <ErrorNote message={error} />
          </div>
        )}
        <div className="max-w-sm">
          <FormField
            label="Delivery fee charged to your customer (₹)"
            hint={
              current.data?.isOwnValue === true
                ? 'Your own figure. Pre-filled on every new order, and editable there.'
                : 'Currently the Skydrop default. Set your own and new orders will start with it.'
            }
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={!mayEdit}
            />
          </FormField>
          <p className="text-text-muted mt-2 text-xs">
            This is what you add to the customer&apos;s collectable amount. It is not what Skydrop
            charges you to deliver — that is separate and unaffected by this.
          </p>
          {mayEdit && (
            <Button
              variant="primary"
              className="mt-3"
              onClick={() => void onSave()}
              disabled={save.isPending || value.trim() === ''}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
