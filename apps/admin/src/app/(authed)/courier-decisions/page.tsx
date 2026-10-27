import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CourierDecisionIndex } from './_components/courier-decision-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('courierDecisionsPage.courierDecisionsSkydropAdmin') };
}

export default function CourierDecisionsPage(): ReactElement {
  return <CourierDecisionIndex />;
}
