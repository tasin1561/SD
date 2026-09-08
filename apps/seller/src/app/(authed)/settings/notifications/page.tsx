import { redirect } from 'next/navigation';

/**
 * The company's notification preferences moved to
 * `/notifications/settings`, where they now sit beside a person's own
 * per-topic choices on one page.
 *
 * A REDIRECT rather than a deletion: this url was a tile on the
 * Settings hub for months and is the kind of page people bookmark, and
 * a 404 tells somebody the feature was removed rather than moved.
 *
 * Deliberately UNGATED — the entry in `page-access.ts` went with the
 * page. Leaving `notifications.manage` on it would bounce somebody
 * without that permission to the dashboard when they followed an old
 * link, instead of landing them on their OWN settings, which are
 * self-service and always theirs (NOTIF-11).
 */
export default function LegacyNotificationPreferencesPage(): never {
  redirect('/notifications/settings');
}
