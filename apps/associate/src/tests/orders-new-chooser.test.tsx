import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/orders/new` is a chooser: v2 form when the gate says enabled, the
 * ORIGINAL form otherwise (disabled or errored), a skeleton only while
 * pending. Uncertainty must never land on v2 (fail-closed).
 */
const gate = vi.hoisted(() => ({
  value: {} as { isPending: boolean; data?: { enabled: boolean } },
}));

vi.mock('@/lib/address-check-hooks', () => ({ useOrderPageV2Enabled: () => gate.value }));
vi.mock('@/i18n/client', () => ({ useT: () => (k: string) => k }));
vi.mock('@skydrop/ui/app/skeleton', () => ({
  SkeletonRows: () => <div data-testid="skeleton" />,
}));
vi.mock('@/app/(authed)/orders/new-v2/v2-form', () => ({
  NewOrderPageForm: () => <div data-testid="form-v2" />,
}));
vi.mock('@/app/(authed)/orders/new/old-form', () => ({
  OldOrderForm: () => <div data-testid="form-old" />,
}));

import Page from '@/app/(authed)/orders/new/page';

function shown(): string[] {
  return ['skeleton', 'form-v2', 'form-old'].filter((id) => screen.queryByTestId(id) !== null);
}

describe('/orders/new chooser', () => {
  beforeEach(() => {
    gate.value = { isPending: true };
  });

  it('gate enabled renders the v2 form', () => {
    gate.value = { isPending: false, data: { enabled: true } };
    render(<Page />);
    expect(shown()).toEqual(['form-v2']);
  });

  it('gate disabled renders the old form', () => {
    gate.value = { isPending: false, data: { enabled: false } };
    render(<Page />);
    expect(shown()).toEqual(['form-old']);
  });

  it('gate pending renders only the skeleton', () => {
    gate.value = { isPending: true };
    render(<Page />);
    expect(shown()).toEqual(['skeleton']);
  });

  it('gate errored renders the old form', () => {
    gate.value = { isPending: false };
    render(<Page />);
    expect(shown()).toEqual(['form-old']);
  });
});
