import type { Metadata } from 'next';
import { CapacityMonitor } from './_components/capacity-monitor';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('systemCapacityPage.systemLimitsSkydropAdmin') };
}

export default function CapacityPage() {
  return <CapacityMonitor />;
}
