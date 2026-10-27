import type { ReactElement } from 'react';
import { RolesIndex } from './_components/roles-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<{ title: string }> {
  const { t } = await getT();
  return { title: t('teamRoles.metaTitle') };
}

export default function SellerRolesPage(): ReactElement {
  return <RolesIndex />;
}
