import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ProductSkus } from '@/app/(authed)/products/_components/product-skus';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';

const sku = (skuCode: string, variantLabel: string | null = null, status = 'ACTIVE') => ({
  skuCode,
  variantLabel,
  status,
});

function show(skus: Parameters<typeof ProductSkus>[0]['skus'], locale: 'en' | 'bn' = 'en') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ProductSkus productId="p1" skus={skus} />
    </LocaleProvider>,
  );
}

describe('SKU chips under a product name', () => {
  it('draws nothing when the list carries no SKUs', () => {
    expect(show(undefined).container.firstChild).toBeNull();
    expect(show([]).container.firstChild).toBeNull();
  });

  it('shows each SKU with its variant after it', () => {
    show([sku('AV-BLK', 'Black'), sku('AV-PLAIN')]);
    const items = within(screen.getByRole('list', { name: 'SKUs' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('AV-BLK · Black');
    expect(items[1]).toHaveTextContent(/^AV-PLAIN$/);
  });

  it('marks a draft or archived variant quiet, and says which in words', () => {
    show([sku('A', null, 'ACTIVE'), sku('B', null, 'DRAFT'), sku('C', null, 'ARCHIVED')]);
    const [live, draft, archived] = screen.getAllByRole('listitem');
    expect(live).not.toHaveClass('prd-sku--quiet');
    expect(draft).toHaveClass('prd-sku--quiet');
    expect(draft).toHaveTextContent('Draft');
    expect(archived).toHaveClass('prd-sku--quiet');
    expect(archived).toHaveTextContent('Archived');
  });

  it('shows four, then "+N more" linking to the product', () => {
    show(['A', 'B', 'C', 'D', 'E', 'F'].map((c) => sku(c)));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    const more = screen.getByRole('link', { name: '+2 more' });
    expect(more).toHaveAttribute('href', '/products/p1');
  });

  it('does not show "+N more" for exactly four', () => {
    show(['A', 'B', 'C', 'D'].map((c) => sku(c)));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('speaks Bangla', () => {
    show(
      ['A', 'B', 'C', 'D', 'E'].map((c) => sku(c)),
      'bn',
    );
    expect(screen.getByRole('link', { name: 'আরও 1টি' })).toBeInTheDocument();
  });
});
