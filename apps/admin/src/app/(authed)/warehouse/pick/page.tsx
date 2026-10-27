import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { PickStation } from './_components/pick-station';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

/**
 * The per-parcel pick station — RETIRED as the ordinary path
 * (2026-09-03), kept for the one job it is still the only way to do.
 *
 * Picking is now batch-and-paper: a printed sheet lists every variant to
 * fetch, consolidated across the orders on it, and the picker ticks
 * their way down it. That is at `/warehouse/printing`, and it is where
 * the nav points.
 *
 * This screen survives because SERIALISED stock cannot be closed from
 * paper. In STRICT mode the scan HERE is what binds each unit to its
 * parcel, and packing then demands the scanned set equal exactly those
 * units (UNIT-2). Retiring this outright would leave that gate
 * comparing against nothing — a conservation invariant traded for a
 * tidier menu.
 *
 * It is also the escape hatch for a parcel that has to be dealt with on
 * its own, off a batch.
 */
export default async function PickPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page">
      <PageHeader
        title={t('warehousePickPage.pickStation')}
        subtitle={t('warehousePickPage.oneParcelAtATime')}
      />
      <div className="wh-banner">
        <span>{t('warehousePickPage.pickingANormalBatch')} </span>
        <Link href="/warehouse/printing">
          {t('warehousePickPage.goToPrinting')} <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <PickStation />
    </div>
  );
}
