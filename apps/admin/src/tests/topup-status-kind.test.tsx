/**
 * WAL-2 / RS-6 — every top-up claim status has a kind and a label (F2),
 * and the admin queue shows a badge rather than the raw enum.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopupRequestStatus } from '@skydrop/db';
import { TopupStatusBadge } from '@skydrop/ui/components';
import { topupStatusKind, topupStatusLabel } from '@skydrop/ui/status';

describe('top-up status', () => {
  it('maps every TopupRequestStatus', () => {
    for (const s of Object.values(TopupRequestStatus)) {
      expect(() => topupStatusKind(s)).not.toThrow();
      expect(topupStatusLabel(s)).not.toBe(s);
    }
    expect(topupStatusKind(TopupRequestStatus.ACCEPTED)).not.toBe(
      topupStatusKind(TopupRequestStatus.REJECTED),
    );
  });

  it('renders a human label, not the enum', () => {
    render(<TopupStatusBadge status={TopupRequestStatus.PENDING} />);
    expect(screen.getByText('Waiting for review')).toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
  });
});
