import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '@skydrop/api-client';
import {
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  StockUnitStatus,
  TicketStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  earlyReviewStatusKind,
  inboundFreightStatusKind,
  stockUnitStatusKind,
  ticketStatusKind,
  withdrawalStatusKind,
} from '@skydrop/ui/status';
import { FreightStatusBadge, TicketStatusBadge } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The R-phase status vocabularies map into the same 8 semantic kinds as
 * orders and shipments (FE-6). These tests exist for two reasons: to
 * pin the handful of mappings where the *wrong* colour would actively
 * mislead, and to prove every enum value is routed — a new value that
 * falls through throws rather than rendering as an unstyled pill.
 */
describe('R-phase status kinds', () => {
  it('routes EVERY value of each vocabulary — no silent fallthrough', () => {
    for (const s of Object.values(TicketStatus)) {
      expect(() => ticketStatusKind(s)).not.toThrow();
    }
    for (const s of Object.values(InboundFreightStatus)) {
      expect(() => inboundFreightStatusKind(s)).not.toThrow();
    }
    for (const s of Object.values(WithdrawalRequestStatus)) {
      expect(() => withdrawalStatusKind(s)).not.toThrow();
    }
    for (const s of Object.values(EarlyReservationReviewStatus)) {
      expect(() => earlyReviewStatusKind(s)).not.toThrow();
    }
    for (const s of Object.values(StockUnitStatus)) {
      expect(() => stockUnitStatusKind(s)).not.toThrow();
    }
  });

  it('does NOT paint a waived freight bill like a settled one', () => {
    // Money we chose not to collect must never scan as money collected —
    // that reading turns a write-off into revenue at a glance.
    expect(inboundFreightStatusKind(InboundFreightStatus.WAIVED)).not.toBe(
      inboundFreightStatusKind(InboundFreightStatus.SETTLED),
    );
  });

  it('distinguishes the three ticket resolutions from each other', () => {
    // A refund moved money, a return moved goods, a write-off moved
    // neither. One colour for all three would hide that.
    const kinds = new Set([
      ticketStatusKind(TicketStatus.RESOLVED_REFUND),
      ticketStatusKind(TicketStatus.RESOLVED_RETURNED),
      ticketStatusKind(TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED),
    ]);
    expect(kinds.size).toBe(3);
  });

  it('renders a readable label, not the raw enum name', () => {
    render(<TicketStatusBadge status={TicketStatus.RESOLVED_REFUND} />);
    expect(screen.getByText(/Resolved Refund/i)).toBeTruthy();
  });

  it('tags the badge with its kind so the token wiring is inspectable', () => {
    const { container } = render(
      <FreightStatusBadge status={InboundFreightStatus.PARTIALLY_SETTLED} />,
    );
    expect(container.querySelector('[data-status-kind="in-transit"]')).toBeTruthy();
  });
});

/**
 * FE-2 — the UI is reading material, the server is law. `serverVerdict`
 * is the one place that formats a refusal, so it is the one place this
 * discipline can be lost.
 */
describe('serverVerdict', () => {
  it('surfaces the code and message VERBATIM', () => {
    const err = new ApiError(409, 'FREIGHT_ALREADY_RECORDED', {
      code: 'FREIGHT_ALREADY_RECORDED',
      message: 'This goods receipt already has a freight bill.',
    });
    expect(serverVerdict(err)).toBe(
      '[FREIGHT_ALREADY_RECORDED] This goods receipt already has a freight bill.',
    );
  });

  it('does not paraphrase or truncate a long guardrail message', () => {
    const message =
      'Refusing to restock: the parcel was received at a different warehouse than it shipped from. Transfer it, or re-inspect as a write-off.';
    const err = new ApiError(409, 'RTO_RESTOCK_WAREHOUSE_MISMATCH', {
      code: 'RTO_RESTOCK_WAREHOUSE_MISMATCH',
      message,
    });
    expect(serverVerdict(err)).toContain(message);
  });

  it('falls back to the error message when the body carries no code', () => {
    expect(serverVerdict(new Error('Network request failed'))).toBe('Network request failed');
  });

  it('never renders "undefined" at the user', () => {
    expect(serverVerdict(null)).toBe('Request failed.');
    expect(serverVerdict({})).toBe('Request failed.');
  });
});
