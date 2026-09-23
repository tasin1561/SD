import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader } from '@skydrop/ui/app/page-header';
import {
  ChevronRight,
  Layers,
  RotateCcw,
  Inbox,
  Grid3x3,
  Ship,
  Printer,
  ScanLine,
} from 'lucide-react';
import './_components/benches.css';

/**
 * Warehouse hub — links to the four station workspaces.
 * Each station has its own page with its own pull-next / action UX.
 */
export default function WarehouseHubPage(): ReactElement {
  return (
    <div className="wh-page">
      <PageHeader
        title="Warehouse"
        subtitle="Consignment → Receive → Print → Pick → Pack → Handover → Dispatch. RTO handled separately."
      />
      <div className="wh-hub">
        <Tile
          href="/warehouse/bins"
          icon={<Grid3x3 size={20} />}
          title="Bins"
          subtitle="Lay out aisles, racks and shelves — and choose whether this building records where stock sits at all."
        />
        <Tile
          href="/warehouse/consignments"
          icon={<Ship size={20} />}
          title="Consignments"
          subtitle="The journey: where each one is, what each stop counted, and the steps counting has no opinion about — labelling, dispatch to India, cancelling."
        />
        <Tile
          href="/warehouse/receive"
          icon={<Inbox size={20} />}
          title="Receive"
          subtitle="Where counting happens. Claim, record qty/damage, putaway, complete — this is the step that writes stock, for consignments and ordinary receipts alike."
        />
        <Tile
          href="/warehouse/printing"
          icon={<Printer size={20} />}
          title="Printing"
          subtitle="Shipping labels, then the picking sheet. The floor works from paper — this is where it comes from."
        />
        <Tile
          href="/warehouse/pack"
          icon={<Layers size={20} />}
          title="Pack"
          subtitle="Pull next picked shipment, pack the parcel, mark complete."
        />
        <Tile
          href="/warehouse/handover"
          icon={<ScanLine size={20} />}
          title="Handover"
          subtitle="Scan each parcel as it goes onto the van. The scan is the handover — the parcel dispatches there and then."
        />
        <Tile
          href="/warehouse/rto"
          icon={<RotateCcw size={20} />}
          title="RTO"
          subtitle="Receive returns, inspect items, finalize disposition (restock / write-off)."
        />
      </div>
    </div>
  );
}

function Tile({
  href,
  icon,
  title,
  subtitle,
}: {
  readonly href: string;
  readonly icon: ReactElement;
  readonly title: string;
  readonly subtitle: string;
}): ReactElement {
  return (
    <Link href={href} className="wh-tile">
      <span className="wh-tile__chip" aria-hidden>
        {icon}
      </span>
      <span className="wh-tile__text">
        <span className="wh-tile__title">{title}</span>
        <span className="wh-tile__sub">{subtitle}</span>
      </span>
      <ChevronRight size={16} className="wh-tile__arrow" aria-hidden />
    </Link>
  );
}
