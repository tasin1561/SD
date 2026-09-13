import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RtoItemRow,
  type RtoItemRowItem,
} from '../app/(authed)/warehouse/rto/_components/rto-item-row';

/**
 * The product picture on the RTO inspect screen (owner, 13 Sep 2026):
 * the inspector judges a returned item's condition and should see what
 * the product is meant to look like while doing it.
 */
const base: RtoItemRowItem = {
  shipmentItemId: 'si-1',
  skuCode: 'AVIATO-GREE-BLAC',
  productName: 'Aviator OG Sunglass',
  variantLabel: null,
  quantity: 1,
  rtoCondition: null,
  rtoDisposition: null,
  rtoInspectionNotes: null,
  thumbnailUrl: 'https://spaces.example/thumb.webp?X-Amz-Signature=abc',
};

const noop = vi.fn(async () => undefined);

describe('RTO line thumbnail', () => {
  it('shows the presigned picture, named for the product and lazy-loaded', () => {
    render(<RtoItemRow item={base} onSave={noop} saving={false} />);
    const img = screen.getByAltText('Aviator OG Sunglass');
    expect(img.getAttribute('src')).toBe(base.thumbnailUrl);
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('opens the picture in a new tab without leaking the page as referrer', () => {
    render(<RtoItemRow item={base} onSave={noop} saving={false} />);
    const link = screen.getByRole('link', { name: /Aviator OG Sunglass/ });
    expect(link.getAttribute('href')).toBe(base.thumbnailUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders a neutral placeholder, not a broken image, when there is none', () => {
    const { container } = render(
      <RtoItemRow item={{ ...base, thumbnailUrl: null }} onSave={noop} saving={false} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    const tile = container.querySelector('[aria-hidden]');
    expect(tile).not.toBeNull();
    expect(tile?.className).toContain('bg-surface-raised');
    // The line itself is unaffected.
    expect(screen.getByText('Aviator OG Sunglass')).toBeTruthy();
  });
});
