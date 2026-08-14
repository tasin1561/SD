import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AccountSecurityView } from './_components/account-security-view';

export const metadata: Metadata = { title: 'Your account · Skydrop Admin' };

/**
 * The signed-in staff member's own account — identity facts, and the
 * one control that ends every other session they have open.
 *
 * Deliberately NOT under /settings: that route is `system_settings`,
 * the runtime configuration of the whole platform. Somebody looking
 * for "sign me out of the laptop I left at the office" is not looking
 * for a settings table, and putting a personal control inside a global
 * one is how a person ends up editing the wrong thing.
 *
 * No entry in `page-access.ts`: the endpoints behind this page are the
 * API's `@StaffSelfService()` set, open to any authenticated staff
 * member, and the table's documented behaviour is that a path matching
 * nothing is allowed through. Adding a permission here would hide a
 * page from the people it exists for.
 */
export default function AccountPage(): ReactElement {
  return <AccountSecurityView />;
}
