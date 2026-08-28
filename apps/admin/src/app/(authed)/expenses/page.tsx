import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ExpensesIndex } from './_components/expenses-index';

export const metadata: Metadata = { title: 'Expenses & investments · Skydrop Admin' };

export default function ExpensesPage(): ReactElement {
  return <ExpensesIndex />;
}
