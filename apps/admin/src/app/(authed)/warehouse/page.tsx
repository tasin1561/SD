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
import { getT } from '@/i18n/server';

/**
 * Warehouse hub — links to the four station workspaces.
 * Each station has its own page with its own pull-next / action UX.
 */
export default async function WarehouseHubPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page">
      <PageHeader
        title={t('warehousePage.warehouse')}
        subtitle={t('warehousePage.consignmentReceivePrintPickPack')}
      />
      <div className="wh-hub">
        <Tile
          href="/warehouse/bins"
          icon={<Grid3x3 size={20} />}
          title={t('warehousePage.bins')}
          subtitle={t('warehousePage.layOutAislesRacksAnd')}
        />
        <Tile
          href="/warehouse/consignments"
          icon={<Ship size={20} />}
          title={t('warehousePage.consignments')}
          subtitle={t('warehousePage.theJourneyWhereEachOne')}
        />
        <Tile
          href="/warehouse/receive"
          icon={<Inbox size={20} />}
          title={t('warehousePage.receive')}
          subtitle={t('warehousePage.whereCountingHappensClaimRecord')}
        />
        <Tile
          href="/warehouse/printing"
          icon={<Printer size={20} />}
          title={t('warehousePage.printing')}
          subtitle={t('warehousePage.shippingLabelsThenThePicking')}
        />
        <Tile
          href="/warehouse/pack"
          icon={<Layers size={20} />}
          title={t('warehousePage.pack')}
          subtitle={t('warehousePage.pullNextPickedShipmentPack')}
        />
        <Tile
          href="/warehouse/handover"
          icon={<ScanLine size={20} />}
          title={t('warehousePage.handover')}
          subtitle={t('warehousePage.scanEachParcelAsIt')}
        />
        <Tile
          href="/warehouse/rto"
          icon={<RotateCcw size={20} />}
          title="RTO"
          subtitle={t('warehousePage.receiveReturnsInspectItemsFinalize')}
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
