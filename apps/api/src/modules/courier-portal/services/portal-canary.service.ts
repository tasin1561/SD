import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CourierPortalMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { TicketDetailPage } from '../pages/ticket-detail.page';
import { PortalChallengeError, PortalSessionService } from './portal-session.service';
import { PortalTaxonomyService } from './portal-taxonomy.service';

/** The setting naming the AWB the canary is allowed to touch. */
const CANARY_AWB_SETTING = 'courier.portal_canary_awb';

export interface CanaryResult {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly steps: Readonly<Record<string, string>>;
  readonly disabledChannel: boolean;
  readonly reason: string | null;
}

/**
 * A nightly full round trip, so a broken portal is discovered by us
 * rather than by a seller.
 *
 * ── WHY A CANARY AND NOT MONITORING ──────────────────────────────────
 * Every failure mode here is silent. A re-skinned page turns a selector
 * into "no messages found", which read-before-write reads as "not
 * present" — and the queue keeps flowing while nothing lands. There is no
 * error to alert on, no latency spike, no 500. The only way to know the
 * automation still works is to make it do the whole thing on purpose,
 * regularly, against a parcel we own.
 *
 * ── FAILURE PAUSES, IT DOES NOT DEMOTE ───────────────────────────────
 * A failed canary sets `pausedUntil` — health — and never touches
 * `writeMode` or `portalMode`. So recovery restores whatever the operator
 * had chosen instead of a mode this code picked, and the ops queue takes
 * over meanwhile because MANUAL was never overwritten.
 *
 * ── IT ALSO REFRESHES THE TAXONOMY ───────────────────────────────────
 * The fetch is a READ, so it runs in SHADOW too. Folding it into the
 * canary means the tree is diffed nightly by the one job that already has
 * a session open, rather than by a second job that has to log in again.
 */
@Injectable()
export class PortalCanaryService {
  private readonly logger = new Logger(PortalCanaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CourierChannelSettingsService,
    private readonly session: PortalSessionService,
    private readonly taxonomy: PortalTaxonomyService,
    private readonly audit: AuditLogService,
  ) {}

  private async canaryAwb(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: CANARY_AWB_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }

  /** Public so it doubles as the manual ops trigger. */
  async run(): Promise<CanaryResult> {
    const settings = await this.settings.get();
    const mode = settings.portalMode;
    const shadow = mode === CourierPortalMode.SHADOW;
    const steps: Record<string, string> = {};

    const awb = await this.canaryAwb();
    if (awb === '') {
      // Deliberately not defaulted to some parcel: a canary that raises
      // and resolves tickets against a REAL customer's shipment is worse
      // than no canary. It needs a parcel we own, named on purpose.
      this.logger.warn(
        `${CANARY_AWB_SETTING} is unset — the portal canary cannot run without an AWB we own`,
      );
      return {
        ran: false,
        ok: false,
        steps,
        disabledChannel: false,
        reason: `${CANARY_AWB_SETTING} is not configured`,
      };
    }

    const started = new Date();
    try {
      const page = await this.session.page();
      steps['login'] = 'ok';

      // Taxonomy first: a read, and the thing most likely to reveal a
      // re-skin before anything is written.
      const tax = await this.taxonomy.fetchAndPersist(page, awb);
      steps['taxonomy'] = `${tax.fetched} categories`;
      if (tax.fetched === 0) {
        return this.fail(steps, 'Taxonomy fetch returned no categories', started, mode);
      }

      // The round trip proper. In SHADOW every step short of a click
      // still happens, which is what makes a shadow canary meaningful.
      const escalation = await this.prisma.client.courierEscalation.findFirst({
        where: { awbNumber: awb },
        select: { externalTicketId: true },
      });
      const ticketId = escalation?.externalTicketId ?? '';

      if (ticketId === '') {
        // No canary ticket yet. In SHADOW that is expected and fine; in
        // LIVE it means the round trip cannot complete and somebody must
        // raise one once.
        steps['thread'] = 'no canary ticket bound';
        return shadow
          ? this.ok(steps, started, mode)
          : this.fail(steps, 'No canary ticket is bound to that AWB', started, mode);
      }

      const detail = new TicketDetailPage(page);
      await detail.open(ticketId);
      const thread = await detail.readThread();
      steps['thread'] = `${thread.length} messages`;
      if (thread.length === 0) {
        // The reading that matters: an empty thread on a ticket we know
        // has history means the selectors have stopped matching.
        return this.fail(steps, 'Thread read returned zero messages', started, mode);
      }

      const marker = `Skydrop automated health check ${started.toISOString()}`;
      const posted = await detail.postComment(marker, shadow);
      steps['comment'] = posted.kind;
      if (posted.kind === 'SENT_UNVERIFIED') {
        return this.fail(steps, `Comment could not be verified: ${posted.reason}`, started, mode);
      }

      const resolved = await detail.resolve(shadow);
      steps['resolve'] = resolved;

      return this.ok(steps, started, mode);
    } catch (err) {
      if (err instanceof PortalChallengeError) {
        // The session already paused and alerted. Do not pause twice.
        steps['login'] = `challenge:${err.challenge}`;
        await this.record(mode, 'CHALLENGE', JSON.stringify(steps), started);
        return {
          ran: true,
          ok: false,
          steps,
          disabledChannel: true,
          reason: `Portal challenge: ${err.challenge}`,
        };
      }
      return this.fail(steps, err instanceof Error ? err.message : String(err), started, mode);
    }
  }

  private async ok(
    steps: Record<string, string>,
    started: Date,
    mode: CourierPortalMode,
  ): Promise<CanaryResult> {
    await this.record(mode, 'OK', JSON.stringify(steps), started);
    this.logger.log(steps, 'Portal canary passed');
    return { ran: true, ok: true, steps, disabledChannel: false, reason: null };
  }

  /**
   * Record, pause the channel, and say why.
   *
   * The pause is 24h: long enough that nobody has to remember to stop it,
   * and short enough that a fixed portal recovers without an intervention
   * nobody scheduled.
   */
  private async fail(
    steps: Record<string, string>,
    reason: string,
    started: Date,
    mode: CourierPortalMode,
  ): Promise<CanaryResult> {
    await this.record(mode, 'FAILED', `${reason} | ${JSON.stringify(steps)}`, started);
    await this.settings.pause({
      until: new Date(Date.now() + 24 * 3_600_000),
      reason: `Portal canary failed: ${reason}`,
    });
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.portal.canary_failed',
      entityType: 'courier',
      entityId: null,
      // The portal is now writing into customer-visible threads without
      // a working verification path, or not writing at all. Either way a
      // human needs to look before it runs again.
      severity: 'CRITICAL',
      metadata: { courierCode: 'delhivery', reason, steps, mode },
    });
    this.logger.error({ reason, steps }, 'Portal canary FAILED — write channel paused for 24h');
    return { ran: true, ok: false, steps, disabledChannel: true, reason };
  }

  private async record(
    mode: CourierPortalMode,
    outcome: string,
    detail: string,
    started: Date,
  ): Promise<void> {
    await this.prisma.client.courierPortalRun.create({
      data: { kind: 'canary', mode, outcome, detail, startedAt: started, endedAt: new Date() },
    });
  }
}
