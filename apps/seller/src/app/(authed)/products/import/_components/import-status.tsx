import type { ReactElement } from 'react';
import { StatusBadge } from '@skydrop/ui/components';
import type { StatusKind } from '@skydrop/ui/status';
import { BulkUploadStatus } from '@skydrop/db';

/**
 * The import's status as a pill.
 *
 * FE-6: no colour is chosen here — the kind maps onto the eight
 * semantic buckets and `StatusBadge` reads their tokens. The switch is
 * F2-exhaustive over `BulkUploadStatus` so a new value fails to compile
 * until somebody decides what it should look like.
 *
 * This mapper belongs beside `ticketStatusKind` and friends in
 * `@skydrop/ui/status`, with a `BulkUploadStatusBadge` next to
 * `TicketStatusBadge` — it is here only because this change does not own
 * that package. Move it when the package is next touched; the call sites
 * below change only their import.
 */
function importStatusKind(status: BulkUploadStatus): StatusKind {
  switch (status) {
    case BulkUploadStatus.PENDING:
      return 'pending';
    case BulkUploadStatus.PROCESSING:
      return 'in-transit';
    case BulkUploadStatus.COMPLETED:
      return 'delivered';
    // Rows landed AND rows were refused. Not a failure — but not done
    // either, because the error report is still waiting to be read.
    case BulkUploadStatus.COMPLETED_WITH_ERRORS:
      return 'rto';
    case BulkUploadStatus.FAILED:
      return 'failed';
    case BulkUploadStatus.CANCELLED:
      return 'cancelled';
  }
}

export function ImportStatusBadge({ status }: { readonly status: BulkUploadStatus }): ReactElement {
  return <StatusBadge kind={importStatusKind(status)} label={humaniseStatus(status)} />;
}

/** `statusLabel` in @skydrop/ui/status takes a fixed union of enums that
 *  does not include this one, so the same lowercase-and-space treatment
 *  is applied here rather than widening a package we do not own. */
export function humaniseStatus(status: BulkUploadStatus): string {
  return String(status).toLowerCase().split('_').join(' ');
}
