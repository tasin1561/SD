import { legFor } from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * Which leg a Delhivery wallet row's charge belongs to, from the parcel's
 * status on that row. RTO (turned round) and DTO (delivered back to the
 * origin — the same return, finished) are both the RETURN; left on the
 * forward leg, a completed return had no return-leg row and was counted
 * as uncovered on the returns line for good.
 */
describe('legFor', () => {
  it.each(['RTO', 'rto', ' RTO ', 'DTO', 'dto'])('%s is the return leg', (status) => {
    expect(legFor(status)).toBe('RTO');
  });

  it.each(['Delivered', 'In Transit', 'Manifested', 'Lost', '', 'RTO-ish', 'Pending'])(
    '%s is the forward leg — matched exactly, never by substring',
    (status) => {
      expect(legFor(status)).toBe('FORWARD');
    },
  );
});
