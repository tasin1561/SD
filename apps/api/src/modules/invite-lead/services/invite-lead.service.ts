import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InviteLeadStatus, NotificationRecipientType, Prisma, StaffRole } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ActorType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { EmailQueue } from '../../email/queue/email.queue';

/**
 * People asking to be let into the beta.
 *
 * The landing page used to open a `mailto:` link. That asks the browser
 * to hand off to a mail client — a chooser dialog on desktop, and on a
 * phone with no mail account configured, nothing at all. Every person
 * who did not complete that handoff was lost, and we never knew one had
 * tried. A form cannot fail that way: either the row is written or the
 * submitter sees an error and can try again.
 *
 * ── Why a second submission UPDATES ──────────────────────────────────
 * `email` is unique and a repeat submission upserts, bumping
 * `submissionCount`. Somebody impatient, or unsure whether the first
 * one went through, should not become two rows in a queue someone works
 * top to bottom. The count is kept because "they asked three times" is
 * useful context for whoever calls them.
 *
 * ── What this deliberately cannot do ─────────────────────────────────
 * Create anything that can log in. A lead is a stranger who typed into
 * a public form; a Seller is invited by staff. Keeping them separate is
 * what makes an open, unauthenticated endpoint safe to have at all —
 * the worst a flood can do is fill a table an admin can filter.
 */

export interface SubmitLeadInput {
  readonly fullName: string;
  readonly companyName: string;
  readonly email: string;
  readonly phone: string;
  readonly productTypes?: string | undefined;
  readonly monthlyOrders?: string | undefined;
  readonly message?: string | undefined;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface LeadView {
  readonly id: string;
  readonly fullName: string;
  readonly companyName: string;
  readonly email: string;
  readonly phone: string;
  readonly productTypes: string | null;
  readonly monthlyOrders: string | null;
  readonly message: string | null;
  readonly status: InviteLeadStatus;
  readonly notes: string | null;
  readonly submissionCount: number;
  readonly contactedAt: Date | null;
  readonly convertedSellerId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class InviteLeadService {
  private readonly logger = new Logger(InviteLeadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
  ) {}

  /**
   * Record a request. Returns nothing about the row on purpose — the
   * public response says only that it was received.
   *
   * Idempotent per email: a second attempt updates the details (people
   * correct a typo and resend) and increments the count, rather than
   * queueing the same person twice.
   */
  async submit(input: SubmitLeadInput): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const data = {
      fullName: input.fullName.trim(),
      companyName: input.companyName.trim(),
      phone: input.phone.trim(),
      productTypes: input.productTypes?.trim() || null,
      monthlyOrders: input.monthlyOrders?.trim() || null,
      message: input.message?.trim() || null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };

    const existing = await this.prisma.client.inviteLead.findUnique({
      where: { email },
      select: { id: true, status: true, submissionCount: true },
    });

    if (!existing) {
      const created = await this.prisma.client.inviteLead.create({
        data: { email, ...data },
        select: { id: true },
      });
      this.logger.log({ leadId: created.id }, 'New invite lead');
      await this.announce(created.id, { email, ...data });
      await this.audit
        .log({
          actorType: ActorType.SYSTEM,
          actorId: null,
          action: 'marketing.invite_lead.created',
          entityType: 'invite_lead',
          entityId: created.id,
          severity: 'LOW',
          metadata: { companyName: data.companyName },
        })
        .catch(() => undefined);
      return;
    }

    // A lead already worked — contacted, qualified, converted — keeps
    // its status. Resetting it to NEW because they filled the form again
    // would put someone already in conversation back at the top of the
    // queue as though nobody had spoken to them.
    await this.prisma.client.inviteLead.update({
      where: { id: existing.id },
      data: { ...data, submissionCount: existing.submissionCount + 1 },
    });
    this.logger.log(
      { leadId: existing.id, submissions: existing.submissionCount + 1 },
      'Repeat invite-lead submission',
    );
  }

  /**
   * Tell someone a lead is waiting.
   *
   * Best-effort by construction: the lead is already committed, and a
   * mail problem must never turn a captured lead into a 500 that makes
   * the visitor think the form is broken and go away. That is the exact
   * failure this whole feature exists to remove.
   *
   * Only on CREATION, not on a repeat. Someone double-clicking, or
   * resending because they were unsure, should not ring the alarm twice
   * — the `submissionCount` on the row already says they were keen.
   *
   * Recipients default to every active SUPER_ADMIN rather than a
   * hardcoded address: that stays correct as admins come and go, and it
   * cannot quietly point at a mailbox nobody opens.
   * `marketing.lead_notification_email` overrides it with a shared inbox
   * when one person should own the queue.
   */
  private async announce(
    leadId: string,
    lead: {
      email: string;
      fullName: string;
      companyName: string;
      phone: string;
      productTypes: string | null;
      monthlyOrders: string | null;
      message: string | null;
    },
  ): Promise<void> {
    try {
      const setting = await this.prisma.client.systemSetting.findUnique({
        where: { key: 'marketing.lead_notification_email' },
        select: { valueString: true },
      });
      const override = setting?.valueString?.trim() ?? '';

      const recipients: Array<{ id: string | null; email: string }> =
        override !== ''
          ? [{ id: null, email: override }]
          : (
              await this.prisma.client.staffUser.findMany({
                where: { role: StaffRole.SUPER_ADMIN, deletedAt: null },
                select: { id: true, email: true },
              })
            ).map((s) => ({ id: s.id, email: s.email }));

      if (recipients.length === 0) {
        // Worth a warning: a lead arrived and nobody was told.
        this.logger.warn(
          { leadId },
          'No SUPER_ADMIN to notify of a new invite lead, and no override address set',
        );
        return;
      }

      const variables = {
        full_name: lead.fullName,
        company_name: lead.companyName,
        email: lead.email,
        phone: lead.phone,
        product_types: lead.productTypes ?? 'not said',
        monthly_orders: lead.monthlyOrders ?? 'not said',
        // The subject carries the volume only when they gave one, so it
        // never reads "— not said" on a phone lock screen.
        volume_suffix: lead.monthlyOrders ? ` (${lead.monthlyOrders}/mo)` : '',
        lead_message: lead.message ?? '',
        leads_url: `${this.env.adminAppUrl}/leads`,
      };

      // One enqueue per recipient, each in its own try/catch: one bad
      // address must not stop the others being told (NOTIF-3).
      for (const r of recipients) {
        try {
          await this.email.enqueue({
            templateCode: 'staff.invite_lead.email',
            recipient: { type: NotificationRecipientType.STAFF, id: r.id, email: r.email },
            variables,
            triggerEvent: 'marketing.invite_lead.created',
          });
        } catch (e) {
          this.logger.error(
            { leadId, err: (e as Error).message },
            'Could not queue the invite-lead alert for one recipient',
          );
        }
      }
    } catch (e) {
      // The lead is safe either way. Losing the alert is a nuisance;
      // losing the lead would be the bug.
      this.logger.error(
        { leadId, err: (e as Error).message },
        'Invite-lead alert failed entirely — the lead IS stored, nobody was told',
      );
    }
  }

  async list(filters: {
    status?: InviteLeadStatus;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: readonly LeadView[];
    total: number;
    page: number;
    pageSize: number;
    counts: Record<string, number>;
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const search = filters.search?.trim();

    const where: Prisma.InviteLeadWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(search
        ? {
            OR: [
              { companyName: { contains: search, mode: 'insensitive' as const } },
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      this.prisma.client.inviteLead.findMany({
        where,
        // Newest first: a lead goes cold fast, so the top of the list is
        // where the value is.
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.inviteLead.count({ where }),
      // Counts across ALL leads, not the filtered set — they are the
      // tab labels, and a tab that shows the count of what you are
      // already looking at tells you nothing.
      this.prisma.client.inviteLead.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count._all;

    return { items: rows.map((r) => this.toView(r)), total, page, pageSize, counts };
  }

  /**
   * Move a lead along, and say what was said.
   *
   * `contactedAt` is stamped the first time it leaves NEW and never
   * re-stamped: it answers "how long did they wait to hear from us",
   * which a later status change would erase.
   */
  async update(
    id: string,
    input: { status?: InviteLeadStatus; notes?: string },
    staffId: string,
  ): Promise<LeadView> {
    const existing = await this.prisma.client.inviteLead.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
    }

    const movingOffNew =
      input.status !== undefined &&
      input.status !== InviteLeadStatus.NEW &&
      existing.contactedAt === null;

    const updated = await this.prisma.client.inviteLead.update({
      where: { id },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.notes === undefined ? {} : { notes: input.notes.trim() || null }),
        ...(movingOffNew ? { contactedAt: new Date() } : {}),
      },
    });

    if (input.status !== undefined && input.status !== existing.status) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        actorId: staffId,
        staffUserId: staffId,
        action: 'marketing.invite_lead.status_changed',
        entityType: 'invite_lead',
        entityId: id,
        severity: 'LOW',
        metadata: { from: existing.status, to: input.status, email: existing.email },
      });
    }
    return this.toView(updated);
  }

  private toView(r: Prisma.InviteLeadGetPayload<Record<string, never>>): LeadView {
    return {
      id: r.id,
      fullName: r.fullName,
      companyName: r.companyName,
      email: r.email,
      phone: r.phone,
      productTypes: r.productTypes,
      monthlyOrders: r.monthlyOrders,
      message: r.message,
      status: r.status,
      notes: r.notes,
      submissionCount: r.submissionCount,
      contactedAt: r.contactedAt,
      convertedSellerId: r.convertedSellerId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
