import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { RolesIndex } from './_components/roles-index';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('rolesPage.metaTitle') };
}

export default function RolesPage(): ReactElement {
  return <RolesIndex />;
}
