'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, ScanLine } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { LabelIntoParcel } from '@skydrop/ui/app/label-into-parcel';
import { TextField } from '@skydrop/ui/app/text-field';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

export function SearchForm({ locale }: { readonly locale: Locale }): ReactElement {
  const router = useRouter();
  const [awb, setAwb] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = awb.trim();
    if (!trimmed) return;
    router.push(`/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit} className="tr-form">
      <TextField
        id="awb"
        type="text"
        autoComplete="off"
        required
        value={awb}
        onChange={(e) => setAwb(e.target.value)}
        label={t(locale, 'awbLabel')}
        placeholder={t(locale, 'awbPlaceholder')}
        icon={<ScanLine size={16} />}
        inputClassName="sk-ident"
      />
      {/* A navigation: the parcel tuck is hover/press feedback only and
          never delays the push. */}
      <LabelIntoParcel>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          iconRight={<ArrowRight size={16} />}
        >
          {t(locale, 'trackButton')}
        </Button>
      </LabelIntoParcel>
    </form>
  );
}
