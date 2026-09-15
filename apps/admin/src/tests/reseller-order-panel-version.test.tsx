/**
 * RS-5 — staff read the terms a reseller order was placed under as a
 * VERSION NUMBER ("Version 3"), never the snapshot row's uuid.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrderView } from '@skydrop/api-client';
import { ResellerOrderPanel } from '@/app/(authed)/orders/_components/reseller-order-panel';

const VERSION_ID = '019fad84-7acd-754e-8ee4-43cf858fed44';

function order(extra: Record<string, unknown>): OrderView {
  return {
    storeKind: 'RESELLER',
    storeId: null,
    storeNameSnapshot: 'Kolkata Kurtis',
    resellerTermsVersionId: VERSION_ID,
    resellerStoreCreditTrigger: null,
    resellerSellerCreditTrigger: null,
    items: [],
    ...extra,
  } as unknown as OrderView;
}

describe('reseller order panel — terms version', () => {
  it('shows the version number, not the uuid', () => {
    render(<ResellerOrderPanel order={order({ resellerTermsVersionNumber: 3 })} />);
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.queryByText(VERSION_ID)).not.toBeInTheDocument();
  });

  it('says nothing it does not know', () => {
    render(<ResellerOrderPanel order={order({ resellerTermsVersionNumber: null })} />);
    expect(screen.queryByText(VERSION_ID)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Version/)).not.toBeInTheDocument();
  });
});
