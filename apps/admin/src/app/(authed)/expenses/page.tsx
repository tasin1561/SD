import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ExpensesIndex } from './_components/expenses-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('expensesPage.expensesInvestmentsSkydropAdmin') };
}

export default function ExpensesPage(): ReactElement {
  return <ExpensesIndex />;
}
