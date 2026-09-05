import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { topicForIssue } from '../../notification-audience/services/notification-topic-catalog.service';

/**
 * Telling a person that something is wrong.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────
 * `SystemIssueService.raise()` recorded a problem and told nobody. The
 * sweeps that call it — the AWB retry loop (ATT-1), the stranded-
 * tracking gap (TRK-10), a duplicate parcel scan (SCAN-1) — exist
 * precisely to catch what nobody notices, and their output landed on a
 * page nobody was asked to open. SD-2026-26-000001 cycled on a
 * seven-hour loop for two days making real courier writes; the reason
 * that went unnoticed was not that it was unrecorded, it was that being
 * recorded is not the same as being told.
 *
 * ── ONLY THE FIRST TIME ──────────────────────────────────────────────
 * A nightly job failing for a fortnight is ONE issue seen fourteen
 * times, and `raise()` already models it that way. Notifying on every
 * recurrence would put fourteen identical lines in an inbox, which is
 * how people learn to ignore the bell — so only a NEW issue notifies.
 * The page carries the occurrence count for anyone who wants it.
 *
 * ── ONLY WHEN IT MATTERS ─────────────────────────────────────────────
 * HIGH and CRITICAL only. LOW is "worth knowing" and MEDIUM is "this
 * stopped and will stay stopped" — both belong on the page, neither is
 * worth interrupting somebody for. CRITICAL additionally emails,
 * because "drop what you are doing" has to reach somebody who is not
 * currently looking at the admin app.
 *
 * ── ADDRESSED TO WHOEVER CAN ACT ─────────────────────────────────────
 * `system.settings.view` is what opens `/system-issues`, so it is on
 * every audience: a notification pointing at a page the reader cannot
 * open is a dead end. Where a second group would act faster — a
 * warehouse supervisor on a duplicate scan, courier ops on a portal
 * login — they are added, and `resolveMany` de-duplicates so somebody
 * holding both is told once.
 */
@Injectable()
export class SystemIssueNotifier {
  private readonly logger = new Logger(SystemIssueNotifier.name);

  constructor(private readonly dispatch: NotificationDispatchService) {}

  /**
   * Best-effort, and it MUST stay that way: every caller is already
   * inside a failure path, and an alerting layer that throws turns a
   * handled problem into an unhandled one. Same discipline as
   * `SystemIssueService.raise()` itself.
   */
  async notify(input: {
    readonly issueId: string;
    readonly kind: SystemIssueKind;
    readonly severity: SystemIssueSeverity;
    readonly title: string;
    readonly detail: string;
  }): Promise<void> {
    if (
      input.severity !== SystemIssueSeverity.HIGH &&
      input.severity !== SystemIssueSeverity.CRITICAL
    ) {
      return;
    }

    const critical = input.severity === SystemIssueSeverity.CRITICAL;
    try {
      await this.dispatch.dispatch({
        // The catalogue's own key function: a topic somebody silenced
        // on their settings page has to be the topic this looks up.
        topic: topicForIssue(input.kind),
        category: NotificationCategory.OPERATIONAL,
        title: critical ? `Critical: ${input.title}` : input.title,
        // The detail says what to DO — it is written at the call site,
        // where the context is — so it is carried through verbatim
        // rather than summarised into something less useful.
        body: `${input.detail}\n\nOpen /system-issues to act on this.`,
        channels: critical
          ? [NotificationChannel.IN_APP, NotificationChannel.EMAIL]
          : [NotificationChannel.IN_APP],
        audience: permissionsFor(input.kind).map((permission) => ({
          kind: 'STAFF_PERMISSION' as const,
          permission,
        })),
        triggerEvent: topicForIssue(input.kind),
        // Keyed on the issue, so a retry of the same raise cannot send
        // twice while a genuinely new issue is unaffected.
        eventId: `system_issue:${input.issueId}`,
      });
    } catch (err) {
      this.logger.error(
        {
          issueId: input.issueId,
          kind: input.kind,
          err: err instanceof Error ? err.message : String(err),
        },
        'Could not notify anybody about a system issue — it is still on /system-issues',
      );
    }
  }
}

/**
 * Who to tell, per kind.
 *
 * F2-exhaustive on purpose: a new `SystemIssueKind` fails to compile
 * until somebody decides who it is for. The alternative — a default
 * audience — is how a new kind of failure comes to be raised for months
 * with nobody addressed by it, which is the exact hole this file
 * exists to close.
 *
 * `system.settings.view` is on every list because it is what opens the
 * page where an issue is resolved.
 */
export function permissionsFor(kind: SystemIssueKind): readonly string[] {
  const RESOLVER = 'system.settings.view';
  switch (kind) {
    case SystemIssueKind.WAREHOUSE_SCAN:
      // A blocked operator is standing at a bench holding a parcel. The
      // supervisor on the floor will act on this minutes before whoever
      // watches the settings page does.
      return [RESOLVER, 'warehouse.pick.supervise'];
    case SystemIssueKind.COURIER_PORTAL_LOGIN:
    case SystemIssueKind.COURIER_PORTAL_CHALLENGE:
    case SystemIssueKind.COURIER_CREDENTIAL:
      return [RESOLVER, 'courier.accounts.manage'];
    case SystemIssueKind.COURIER_COST_SYNC:
      return [RESOLVER, 'courier.accounts.view'];
    case SystemIssueKind.TRACKING_STALLED:
      // A parcel whose scans stopped matching its order. Whoever works
      // orders sees the consequence first.
      return [RESOLVER, 'orders.view'];
    case SystemIssueKind.INTEGRATION:
    case SystemIssueKind.OTHER:
      return [RESOLVER];
    default: {
      const never: never = kind;
      throw new Error(`SystemIssueNotifier: no audience decided for kind ${String(never)}`);
    }
  }
}
