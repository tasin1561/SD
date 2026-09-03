import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader, Card, CardBody } from '@skydrop/ui/components';
import {
  PackageCheck,
  Layers,
  RotateCcw,
  Inbox,
  Truck,
  Grid3x3,
  Ship,
  FileText,
} from 'lucide-react';

/**
 * Warehouse hub — links to the four station workspaces.
 * Each station has its own page with its own pull-next / action UX.
 */
export default function WarehouseHubPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Warehouse"
        subtitle="Consignment → Receive → Pick → Pack → Manifest → Pickup → Dispatch. RTO handled separately."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          href="/warehouse/pick"
          icon={<PackageCheck size={20} />}
          title="Pick"
          subtitle="Pull next confirmed order, allocate stock from bins, mark complete."
        />
        <Tile
          href="/warehouse/pack"
          icon={<Layers size={20} />}
          title="Pack"
          subtitle="Pull next picked shipment, pack the parcel, mark complete."
        />
        <Tile
          href="/warehouse/pickups"
          icon={<Truck size={20} />}
          title="Pickups"
          subtitle="Ask the courier for a van. One request covers a warehouse's whole handover for the day — not one per parcel."
        />
        <Tile
          href="/warehouse/manifests"
          icon={<FileText size={20} />}
          title="Manifests"
          subtitle="A record of which parcels went out together. Close one, then confirm the driver took them."
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
    <Link href={href} className="block">
      <Card className="hover:border-border-strong transition-colors">
        <CardBody>
          <div className="flex items-start gap-3">
            <div className="text-accent">{icon}</div>
            <div>
              <div className="text-text-bright font-medium text-sm">{title}</div>
              <div className="text-text-muted text-xs mt-0.5">{subtitle}</div>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
