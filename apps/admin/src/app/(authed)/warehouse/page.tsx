import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader, Card, CardBody } from '@skydrop/ui/components';
import { PackageCheck, Layers, FileText, RotateCcw } from 'lucide-react';

/**
 * Warehouse hub — links to the four station workspaces.
 * Each station has its own page with its own pull-next / action UX.
 */
export default function WarehouseHubPage(): ReactElement {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Warehouse"
        subtitle="Pick → Pack → Manifest → Dispatch. RTO handled separately."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          href="/warehouse/manifests"
          icon={<FileText size={20} />}
          title="Manifests"
          subtitle="DRAFT manifests assemble packed shipments; close to trigger AWB."
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
