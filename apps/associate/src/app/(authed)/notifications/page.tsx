import type { ReactElement } from 'react';
import { NotificationsView } from './_components/notifications-view';

/**
 * This person's own inbox.
 *
 * UNGATED, and that is NOTIF-11 rather than an oversight: every row is
 * addressed to the caller by the id on their token, so a permission
 * would be asking a question the token has already answered — and a
 * permission has to be GRANTED, so a key added today reaches no role
 * that already exists and the bell would render then 403 for most of the
 * estate on the day it shipped. It is absent from `PAGE_PERMISSIONS` for
 * exactly that reason; the API's `StoreNotificationController` is
 * `@StoreSelfService()` to match.
 */
export default function NotificationsPage(): ReactElement {
  return <NotificationsView />;
}
