import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader } from '@skydrop/ui/components';
import { PickStation } from './_components/pick-station';

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
export default function PickPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Pick station"
        subtitle="One parcel at a time. The everyday path is batch picking — this is for serialised stock, which must be scanned unit by unit, and for one-off parcels."
      />
      <div className="border-border bg-surface-raised mb-4 rounded-lg border p-3 text-sm">
        <span className="text-text-body">Picking a normal batch? </span>
        <Link href="/warehouse/printing" className="text-accent font-medium">
          Go to Printing →
        </Link>
      </div>
      <PickStation />
    </div>
  );
}
