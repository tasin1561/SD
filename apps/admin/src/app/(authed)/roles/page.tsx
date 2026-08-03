import type { ReactElement } from 'react';
import { RolesIndex } from './_components/roles-index';

export const metadata = { title: 'Roles · Skydrop admin' };

export default function RolesPage(): ReactElement {
  return <RolesIndex />;
}
