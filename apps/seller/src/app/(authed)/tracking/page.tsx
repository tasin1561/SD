import type { ReactElement } from 'react';
import { PageHeader, EmptyState } from '@skydrop/ui/components';

/**
 * Tracking — embed the M10 PublicTrackingReadService projection for
 * the seller's own AWBs. Customer-safe shape; the seller-side view
 * adds internal context (their own order ref, etc.) above the
 * public timeline.
 */
export default function TrackingPage(): ReactElement {
  return (
    <>
      <PageHeader title="Tracking" subtitle="AWB-keyed shipment timeline." />
      <EmptyState
        title="Tracking deep-link arrives with CP2.A order detail"
        description="The seller order-detail page embeds the customer-safe tracking projection; a standalone AWB search lives here in a later fast-follow."
      />
    </>
  );
}
