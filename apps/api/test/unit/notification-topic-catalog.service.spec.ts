import {
  NotificationRecipientType,
  NotificationSubjectType,
  OrderStatus,
  SystemIssueKind,
} from '@skydrop/db';
import {
  NotificationTopicCatalogService,
  SELLER_TOPICS,
  STAFF_TOPICS,
  topicForIssue,
} from '../../src/modules/notification-audience/services/notification-topic-catalog.service';
import { NotificationEventMappingService } from '../../src/modules/notifications/services/notification-event-mapping.service';
import { permissionsFor } from '../../src/modules/system-issues/services/system-issue-notifier.service';

/**
 * The catalogue is a list of words, and words drift.
 *
 * It is DECLARED rather than derived because deriving it would mean
 * `notification-audience` importing `notifications`, which imports it —
 * a cycle, and the R3 rule says extract rather than `forwardRef`. There
 * is nothing to extract: the list is names for humans.
 *
 * So the guarantee is a test instead, in BOTH directions. A test can
 * import what a module cannot. Same technique as the M10 mapping/matrix
 * consistency suite (F6), and it catches the failure that matters: a
 * topic somebody silences on their settings page that the dispatcher
 * never looks up, which reads as a mute that does nothing.
 */
describe('NotificationTopicCatalogService', () => {
  const svc = new NotificationTopicCatalogService();
  const mapping = new NotificationEventMappingService();

  /** Every in-app topic the seller listener can actually send. */
  function sellerTopicsTheListenerSends(): Set<string> {
    const out = new Set<string>();
    for (const status of Object.values(OrderStatus)) {
      for (const t of mapping.resolveForOrderStatus(status)) {
        if (t.recipientType === NotificationRecipientType.SELLER && t.inApp !== undefined) {
          // The listener strips `.email` — the catalogue must use the
          // key that ends up on the row, not the one on the template.
          out.add(t.templateCode.replace(/\.email$/, ''));
        }
      }
    }
    return out;
  }

  it('every topic a seller can silence is one the listener actually sends', () => {
    // A topic in the catalogue that nothing sends is a switch with
    // nothing behind it — the same defect as the preferences screen
    // that stored settings nobody read.
    const sent = sellerTopicsTheListenerSends();
    const orphaned = SELLER_TOPICS.map((t) => t.topic).filter((t) => !sent.has(t));
    expect(orphaned).toEqual([]);
  });

  it('every in-app notification a seller receives is one they can silence', () => {
    // The other direction, and the one that bites: a notification with
    // no catalogue entry cannot be switched off through any screen.
    const listed = new Set(SELLER_TOPICS.map((t) => t.topic));
    const unlisted = [...sellerTopicsTheListenerSends()].filter((t) => !listed.has(t));
    expect(unlisted).toEqual([]);
  });

  it('every system-issue kind has a staff topic, keyed the way the notifier keys it', () => {
    const listed = new Set(STAFF_TOPICS.map((t) => t.topic));
    const missing = Object.values(SystemIssueKind)
      .map(topicForIssue)
      .filter((t) => !listed.has(t));
    expect(missing).toEqual([]);
    // And nothing extra: a staff topic with no issue kind behind it
    // never fires.
    const known = new Set(Object.values(SystemIssueKind).map(topicForIssue));
    expect(STAFF_TOPICS.map((t) => t.topic).filter((t) => !known.has(t))).toEqual([]);
  });

  it('every staff topic has somebody who would be told about it', () => {
    // A topic whose audience is empty is a preference about a
    // notification that reaches nobody.
    for (const kind of Object.values(SystemIssueKind)) {
      expect(permissionsFor(kind).length).toBeGreaterThan(0);
    }
  });

  it('serves the right list per subject, and they do not overlap', () => {
    expect(svc.forSubject(NotificationSubjectType.SELLER_USER)).toBe(SELLER_TOPICS);
    expect(svc.forSubject(NotificationSubjectType.STAFF_USER)).toBe(STAFF_TOPICS);
    const seller = new Set(SELLER_TOPICS.map((t) => t.topic));
    expect(STAFF_TOPICS.filter((t) => seller.has(t.topic))).toEqual([]);
  });

  it('every entry is written for a person, not an enum', () => {
    for (const t of [...SELLER_TOPICS, ...STAFF_TOPICS]) {
      expect(t.label.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.group.length).toBeGreaterThan(2);
      // The label is what somebody reads next to a switch. If it is the
      // key again, the screen is still asking them to know codes.
      expect(t.label).not.toBe(t.topic);
    }
  });
});
