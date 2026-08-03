import type { Metadata } from 'next';
import { CapacityMonitor } from './_components/capacity-monitor';

export const metadata: Metadata = { title: 'System limits · Skydrop Admin' };

export default function CapacityPage() {
  return <CapacityMonitor />;
}
