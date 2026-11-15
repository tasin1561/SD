import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { UatFieldsProvider, useUatField } from '@skydrop/ui/app/uat-fields';
import { prefixHint } from '@/lib/seller-prefix';

const ALL = { orderDeliveryFee: false, orderDiscount: false, orderDeclaredValue: false };

/** The forms hand `prefixHint` null initials when the setting is OFF. */
function effectiveInitials(on: boolean, own: string | null): string | null {
  return on ? own : null;
}

describe('uat.recipient_name_prefix on the order forms', () => {
  it('is OFF with no provider (fails closed), so the helper is hidden', () => {
    const { result } = renderHook(() => useUatField('recipientNamePrefix'));
    expect(result.current).toBe(false);
    expect(prefixHint(effectiveInitials(result.current, 'MST'))).toBe('');
  });

  it('is OFF when the API says so', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UatFieldsProvider value={{ ...ALL, recipientNamePrefix: false }}>
        {children}
      </UatFieldsProvider>
    );
    const { result } = renderHook(() => useUatField('recipientNamePrefix'), { wrapper });
    expect(prefixHint(effectiveInitials(result.current, 'MST'))).toBe('');
  });

  it('shows the helper naming the code when ON', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UatFieldsProvider value={{ ...ALL, recipientNamePrefix: true }}>
        {children}
      </UatFieldsProvider>
    );
    const { result } = renderHook(() => useUatField('recipientNamePrefix'), { wrapper });
    expect(prefixHint(effectiveInitials(result.current, 'MST'))).toContain('MST');
  });
});
