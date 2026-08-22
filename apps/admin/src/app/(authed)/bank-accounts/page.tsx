import type { ReactElement } from 'react';
import { BankAccountsPanel } from './_bank-accounts-panel';

/**
 * Our own bank accounts — the ones a seller wires money to.
 *
 * Split off the top-ups queue, where it used to sit as a second card.
 * The two are different jobs on different clocks: the queue is worked
 * daily and is somebody's inbox, while these accounts are set up once
 * and then left alone for months. Stacking configuration under a
 * worklist makes the page read as two half-finished screens, and buries
 * the thing you only come looking for deliberately.
 */
export default function BankAccountsPage(): ReactElement {
  return <BankAccountsPanel />;
}
