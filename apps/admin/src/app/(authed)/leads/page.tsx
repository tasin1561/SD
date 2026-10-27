import type { Metadata } from 'next';
import { LeadsIndex } from './_components/leads-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('leadsPage.inviteRequestsSkydropAdmin') };
}

export default function LeadsPage() {
  return <LeadsIndex />;
}
