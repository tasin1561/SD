import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { CallCenterStation } from './_components/call-center-station';

/**
 * Single-page call-center agent workspace. CALL_AGENT role pulls
 * the next FIFO call, sees the recipient + items, picks an outcome,
 * and records it. The order auto-transitions per the CC-2 mapping.
 */
export default function CallCenterPage(): ReactElement {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Call centre"
        subtitle="Pull a call, talk to the customer, record the outcome. The order moves automatically."
      />
      <CallCenterStation />
    </div>
  );
}
