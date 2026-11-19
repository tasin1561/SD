import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { SellerFailedAttemptView } from '@skydrop/api-client';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import {
  FailedAttemptsSection,
  relativeTime,
} from '@/app/(authed)/needs-attention/_components/failed-attempts-section';

const NOW = Date.parse('2026-11-19T12:00:00Z');

function row(over: Partial<SellerFailedAttemptView> = {}): SellerFailedAttemptView {
  return {
    orderId: 'o1',
    orderNumber: 'SD-1001',
    recipientName: 'Asha Rao',
    recipientPhoneE164: '+919800000001',
    codAmountInr: '1499.00',
    awbNumber: '1234567890',
    courierCode: 'DELHIVERY',
    failedAt: '2026-11-19T10:00:00Z',
    attemptCount: 2,
    lastRemark: 'Consignee refused to accept',
    lastLocation: 'Pune',
    attemptsFailed: 2,
    attemptsMax: 3,
    deadlineDays: 2,
    remarkVerified: false,
    ...over,
  };
}

function show(rows: readonly SellerFailedAttemptView[], locale: 'en' | 'bn' = 'en') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <FailedAttemptsSection rows={rows} now={NOW} />
    </LocaleProvider>,
  );
}

describe('needs attention: delivery attempt failed', () => {
  it('draws nothing at all when there are no failed attempts', () => {
    expect(show([]).container.firstChild).toBeNull();
  });

  it('puts every fact on the card and links the order', () => {
    show([row()]);
    const list = screen.getByRole('list', { name: 'Delivery attempt failed' });
    const card = within(list).getByRole('listitem');
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/orders/o1');
    expect(card).toHaveTextContent('SD-1001');
    expect(card).toHaveTextContent('1234567890');
    expect(card).toHaveTextContent('Attempt 2 failed');
    expect(card).toHaveTextContent('Consignee refused to accept');
    expect(card).toHaveTextContent('2 hours ago');
    expect(card).toHaveTextContent('Delhivery deadline: 2 days');
    expect(card).toHaveTextContent('2 of 3 attempts');
    expect(card).toHaveTextContent('Remark not verified');
  });

  it('shows the red chip only when the remark was checked and failed', () => {
    show([
      row({ orderId: 'a', remarkVerified: true }),
      row({ orderId: 'b', remarkVerified: null }),
    ]);
    expect(screen.queryByText('Remark not verified')).toBeNull();
  });

  it('leaves out a fact the courier panel has not given us', () => {
    show([
      row({
        deadlineDays: null,
        attemptsFailed: null,
        attemptsMax: null,
        lastRemark: null,
        failedAt: null,
        awbNumber: null,
        remarkVerified: null,
      }),
    ]);
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('Attempt 2 failed');
    expect(card).not.toHaveTextContent('Delhivery deadline');
    expect(card).not.toHaveTextContent('attempts');
    expect(card).not.toHaveTextContent('ago');
  });

  it('lists the newest failure first', () => {
    show([
      row({ orderId: 'old', orderNumber: 'SD-OLD', failedAt: '2026-11-17T10:00:00Z' }),
      row({ orderId: 'none', orderNumber: 'SD-NONE', failedAt: null }),
      row({ orderId: 'new', orderNumber: 'SD-NEW', failedAt: '2026-11-19T11:30:00Z' }),
    ]);
    const cards = screen.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('SD-NEW');
    expect(cards[1]).toHaveTextContent('SD-OLD');
    expect(cards[2]).toHaveTextContent('SD-NONE');
  });

  it('speaks Bangla with 0-9 digits', () => {
    show([row()], 'bn');
    expect(
      screen.getByRole('list', { name: 'ডেলিভারির চেষ্টা ব্যর্থ হয়েছে' }),
    ).toBeInTheDocument();
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('মন্তব্য যাচাই হয়নি');
    expect(card).toHaveTextContent('2 ঘণ্টা আগে');
    expect(card).toHaveTextContent('Delhivery-র সময়সীমা: 2 দিন');
  });

  it('words a gap in minutes, hours or days', () => {
    expect(relativeTime('2026-11-19T11:40:00Z', NOW, 'en')).toBe('20 minutes ago');
    expect(relativeTime('2026-11-19T07:00:00Z', NOW, 'en')).toBe('5 hours ago');
    expect(relativeTime('2026-11-16T12:00:00Z', NOW, 'en')).toBe('3 days ago');
  });
});
