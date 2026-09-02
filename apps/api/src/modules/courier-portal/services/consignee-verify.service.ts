import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PortalSessionService } from './portal-session.service';
import { ConsigneeCheckPage } from '../pages/consignee-check.page';

export interface VerifySweepSummary {
  readonly checked: number;
  readonly confirmed: number;
  readonly mismatched: number;
  readonly unreadable: number;
}

/**
 * Go and look at whether a correction actually landed.
 *
 * Their edit API returning success means they took the request. It does
 * not mean their record changed, and the track API carries no consignee
 * details — so the only way to know is to open their own screen and
 * read it. That is what this does, in the portal process, where the
 * browser already lives.
 *
 * ── WHAT "VERIFIED" MEANS, EXACTLY ───────────────────────────────────
 * That the NEW value appears on their page. Not that the old one is
 * gone, and not a field-by-field equality: their markup has no stable
 * hook per value, so a comparison that guesses which line is the phone
 * would eventually compare the wrong pair and report a false mismatch —
 * which is worse than no answer, because somebody would act on it.
 *
 * ── A FAILURE TO READ IS NOT A MISMATCH ──────────────────────────────
 * `verifiedMatch = false` says their screen still shows the old value:
 * a real, actionable finding. A page that would not load leaves
 * `verifiedAt` NULL and is picked up next time. Conflating them would
 * turn every portal wobble into "your address change did not work".
 */
@Injectable()
export class ConsigneeVerifyService {
  private readonly logger = new Logger(ConsigneeVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
  ) {}

  async sweep(limit = 20): Promise<VerifySweepSummary> {
    // Accepted by the courier, not yet looked at. Oldest first, so a
    // backlog drains rather than the same rows being retried.
    const pending = await this.prisma.client.shipmentAddressChange.findMany({
      where: { courierAcceptedAt: { not: null }, verifiedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        nameAfter: true,
        phoneAfter: true,
        addressAfter: true,
        shipment: { select: { awbNumber: true, courierAccountId: true } },
      },
    });

    const summary = { checked: 0, confirmed: 0, mismatched: 0, unreadable: 0 };
    if (pending.length === 0) return summary;

    for (const c of pending) {
      const awb = c.shipment.awbNumber;
      const accountId = c.shipment.courierAccountId;
      if (awb === null || accountId === null) continue;
      summary.checked += 1;

      try {
        const page = await this.session.page(accountId);
        const seen = await new ConsigneeCheckPage(page).read(awb);

        if (!seen.found || seen.address === null) {
          // Left unverified on purpose: next sweep tries again.
          summary.unreadable += 1;
          continue;
        }

        // Every value we asked them to set must appear. Phone is
        // compared on DIGITS — their screen renders it with spaces and
        // country-code styling that we never sent.
        const blob = seen.address.replace(/\s+/g, ' ');
        const digits = blob.replace(/\D/g, '');
        const wanted: Array<[string, boolean]> = [];
        if (c.nameAfter !== null) wanted.push([c.nameAfter, blob.includes(c.nameAfter)]);
        if (c.addressAfter !== null) {
          wanted.push([c.addressAfter, blob.includes(c.addressAfter)]);
        }
        if (c.phoneAfter !== null) {
          wanted.push([c.phoneAfter, digits.includes(c.phoneAfter.replace(/\D/g, ''))]);
        }
        const match = wanted.every(([, ok]) => ok);
        const missing = wanted.filter(([, ok]) => !ok).map(([v]) => v);

        await this.prisma.client.shipmentAddressChange.update({
          where: { id: c.id },
          data: {
            verifiedAt: new Date(),
            verifiedMatch: match,
            verificationNote: match
              ? 'Confirmed on the courier’s own screen.'
              : `Their screen does not show: ${missing.join(', ')}`,
          },
        });
        if (match) summary.confirmed += 1;
        else summary.mismatched += 1;
      } catch (err) {
        summary.unreadable += 1;
        this.logger.warn(
          { changeId: c.id, err: err instanceof Error ? err.message : String(err) },
          'Could not verify a consignee change; leaving it for the next sweep',
        );
      }
    }

    this.logger.log(summary, 'Consignee verification sweep done');
    return summary;
  }
}
