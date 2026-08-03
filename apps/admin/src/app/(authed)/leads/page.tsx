import type { Metadata } from 'next';
import { LeadsIndex } from './_components/leads-index';

export const metadata: Metadata = { title: 'Invite requests · Skydrop Admin' };

export default function LeadsPage() {
  return <LeadsIndex />;
}
