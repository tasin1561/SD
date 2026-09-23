import type { ReactElement } from 'react';
import type { WalletEntryDirection } from '@skydrop/db';
import { walletDirectionLabel } from '@skydrop/ui/status';

/**
 * What a ledger row says it is: the direction's label and, beneath it, the
 * entry's note.
 *
 * The note is shown for EVERY direction, not a chosen few — for a staff
 * wallet transfer ("Credited by Skydrop" / "Debited by Skydrop") it is the
 * reason the member of staff gave, and it is the only explanation the
 * seller ever gets for money that moved on somebody else's decision.
 */
export function LedgerEntryLabel({
  direction,
  note,
}: {
  readonly direction: WalletEntryDirection;
  readonly note: string | null;
}): ReactElement {
  return (
    <>
      {walletDirectionLabel(direction)}
      {note && <div className="wal-type__note">{note}</div>}
    </>
  );
}
