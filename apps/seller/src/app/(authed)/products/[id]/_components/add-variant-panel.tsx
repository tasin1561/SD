'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  Actions,
  FieldGrid,
  InlineError,
  Note,
  busyPhase,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { verdict } from '@/i18n/verdict';
import { useCreateVariant } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';

/**
 * Add another variant to a product that already exists.
 *
 * Inline rather than its own route: the product is on screen, the seller
 * is adding a second size to it, and a page change would lose that
 * context for one short form. It is also a SINGLE call, unlike the
 * create-product flow — the product is already there, so there is no
 * half-created state to explain.
 *
 * Physical fields are omitted deliberately. A second variant usually
 * shares the first one's weight and dimensions, and the variant page
 * edits them; asking again here would make the common case longer to
 * serve the rare one.
 */
export function AddVariantPanel({
  productId,
  onDone,
}: {
  readonly productId: string;
  readonly onDone: () => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const createVariant = useCreateVariant();
  const [skuCode, setSkuCode] = useState('');
  const [variantLabel, setVariantLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!skuCode.trim()) {
      setError(t('productDetail.skuIsRequired'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createVariant.mutateAsync({
        productId,
        body: {
          skuCode: skuCode.trim(),
          ...(variantLabel.trim() ? { variantLabel: variantLabel.trim() } : {}),
        },
      });
      toast.success(t('productDetail.variantAdded'));
      setSkuCode('');
      setVariantLabel('');
      onDone();
    } catch (err) {
      // FE-2: the server's verdict verbatim — a duplicate SKU is its
      // call to make, not something guessed at from a stale list here.
      setError(verdict(err, t, t('productDetail.somethingWentWrong')));
    } finally {
      setBusy(false);
    }
  }

  // No card of its own: it opens INSIDE the variants panel, which is
  // already a surface. A card here drew a box inside a box.
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="inv-stack">
      {error !== null && <InlineError message={error} />}
      <FieldGrid columns={2}>
        <TextField
          label={t('productDetail.sku')}
          hint={t('productDetail.uniqueAcrossYourCatalogue')}
          value={skuCode}
          onChange={(e) => setSkuCode(e.target.value)}
          maxLength={120}
          required
          inputClassName="sk-ident"
        />
        <TextField
          label={t('productDetail.variantLabel')}
          hint={t('productDetail.eGBlueL')}
          value={variantLabel}
          onChange={(e) => setVariantLabel(e.target.value)}
          maxLength={120}
        />
      </FieldGrid>
      <Note>{t('productDetail.weightDimensionsAndValue')}</Note>
      <Actions>
        <AsyncButton
          type="submit"
          variant="primary"
          size="md"
          icon={<Plus size={15} />}
          labels={{ idle: t('productDetail.addVariant'), busy: t('productDetail.adding') }}
          state={busyPhase(busy)}
        />
        <Button type="button" variant="secondary" size="md" disabled={busy} onClick={onDone}>
          {t('productDetail.cancel')}
        </Button>
      </Actions>
    </form>
  );
}
