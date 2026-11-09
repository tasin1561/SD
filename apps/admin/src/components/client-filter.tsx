'use client';

import type { ReactElement } from 'react';
import { Select } from '@skydrop/ui/app/select';
import { useSellersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

/**
 * "Filter by client" for an admin list.
 *
 * The UI word is Client; the code word is `seller*` (consoles.md).
 *
 * The client list needs `sellers.view`, which is a DIFFERENT permission
 * from the one that opens most pages carrying this control. A staff
 * member may hold one and not the other, so the control renders nothing
 * without it: an empty dropdown would read as "no clients exist". The
 * hook is self-gating too, so no request is made. The server still
 * decides what is allowed (FE-2) — this only decides what is drawn.
 *
 * A selected id that is not among the first 100 clients (a deep link, a
 * large client list) stays selectable as "This client" rather than the
 * select silently snapping back to "All clients".
 *
 * Owners reset their own page to 1 in `onChange`.
 */
export function ClientFilter({
  value,
  onChange,
  id,
}: {
  readonly value: string;
  readonly onChange: (sellerId: string) => void;
  readonly id?: string;
}): ReactElement | null {
  const t = useT();
  const mayRead = usePermission('sellers.view');
  const sellers = useSellersList({ page: 1, pageSize: 100 });
  if (!mayRead) return null;

  const options = sellers.data?.items ?? [];
  const missing = value !== '' && !options.some((s) => s.id === value);

  return (
    <Select
      {...(id === undefined ? {} : { id })}
      label={t('clientFilter.label')}
      aria-label={t('clientFilter.aria')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('clientFilter.all')}</option>
      {missing && <option value={value}>{t('clientFilter.this')}</option>}
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.companyName}
        </option>
      ))}
    </Select>
  );
}
