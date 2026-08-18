import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/components';
import { AlertConfigPanel } from './_components/alert-config-panel';

/**
 * Stock alerts, in Settings.
 *
 * It used to sit at the top of /inventory, where it read as part of the
 * stock figures rather than as a preference: the page is a picture of
 * what is in the warehouse right now, and this is a standing choice about
 * when to be told something is running out. Moving it also stops the
 * one thing on that page a seller is not supposed to change every day
 * from being the first thing they see.
 *
 * The per-SKU override stays on the variant page, next to the SKU it
 * applies to.
 */
export default function StockSettingsPage(): ReactElement {
  return (
    <div>
      <Link
        href="/settings"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft size={12} /> Settings
      </Link>
      <PageHeader
        title="Stock alerts"
        subtitle="When we warn you that a SKU is running out. A SKU with its own threshold ignores this one."
      />
      <AlertConfigPanel />
    </div>
  );
}
