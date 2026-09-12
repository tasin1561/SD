import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierSupportRegistryService } from './courier-support-registry.service';

/** What an operator is shown about a courier's support desk. */
export interface SupportDeskView {
  readonly courierCode: string;
  readonly courierName: string;
  /** Their panel, or null when we have no desk on file for this courier. */
  readonly panelUrl: string | null;
  /** Direct link to THIS ticket when their panel has one, else null. */
  readonly ticketUrl: string | null;
  /** From `courier.<code>_support_email`; null while unset. */
  readonly supportEmail: string | null;
  /** The setting to fill in when the email is missing — named, not implied. */
  readonly supportEmailSettingKey: string;
  readonly howTo: string;
  /** Always false today, for every courier: a person sends it. */
  readonly canSendAutomatically: boolean;
}

/** The per-courier email key. Derived from the code, so a third courier is a data change. */
export function supportEmailKey(courierCode: string): string {
  return `courier.${courierCode}_support_email`;
}

/**
 * Where a person takes an escalation, for whichever courier carried it.
 *
 * ── ONE ANSWER FOR EVERY COURIER ─────────────────────────────────────
 * The courier-specific half (their panel, their ticket URL) comes from
 * the courier's own support adapter through the registry, and the email
 * from a per-courier setting. Nothing here names a courier: a Shiprocket
 * item and a Delhivery item go through the same lines, which is the
 * whole of what "Shiprocket tickets work like Delhivery's" means (CUR-12).
 *
 * A courier with no adapter (the `manual` courier) still gets an answer,
 * saying there is no desk on file — never Delhivery's desk by default,
 * which is how a message meant for one company is filed with another.
 */
@Injectable()
export class CourierSupportDeskService {
  private readonly logger = new Logger(CourierSupportDeskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierSupportRegistryService,
  ) {}

  async describe(courierCode: string, externalTicketId?: string | null): Promise<SupportDeskView> {
    const many = await this.describeMany([
      { courierCode, externalTicketId: externalTicketId ?? null },
    ]);
    const view = many[0];
    if (view === undefined) throw new Error('describeMany returned nothing for one input');
    return view;
  }

  /** One settings read for a whole page of items. */
  async describeMany(
    inputs: readonly { courierCode: string; externalTicketId: string | null }[],
  ): Promise<SupportDeskView[]> {
    const codes = [...new Set(inputs.map((i) => i.courierCode))];
    const emails = new Map<string, string>();
    if (codes.length > 0) {
      try {
        const rows = await this.prisma.client.systemSetting.findMany({
          where: { key: { in: codes.map(supportEmailKey) } },
          select: { key: true, valueString: true },
        });
        for (const r of rows) emails.set(r.key, (r.valueString ?? '').trim());
      } catch (err) {
        // A missing address is shown as missing; it must not take the
        // queue page down with it.
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Could not read courier support emails',
        );
      }
    }

    return inputs.map(({ courierCode, externalTicketId }) => {
      const adapter = this.registry.for(courierCode);
      const key = supportEmailKey(courierCode);
      const email = emails.get(key) ?? '';
      const supportEmail = email === '' ? null : email;
      if (adapter === null) {
        return {
          courierCode,
          courierName: courierCode,
          panelUrl: null,
          ticketUrl: null,
          supportEmail,
          supportEmailSettingKey: key,
          howTo: 'No support desk is on file for this courier — contact them directly.',
          canSendAutomatically: false,
        };
      }
      const desk = adapter.supportDesk();
      const caps = adapter.capabilities();
      const ref = (externalTicketId ?? '').trim();
      return {
        courierCode,
        courierName: desk.displayName,
        panelUrl: desk.panelUrl,
        ticketUrl:
          ref !== '' && desk.ticketUrlTemplate !== null
            ? desk.ticketUrlTemplate.replace('{ticketId}', encodeURIComponent(ref))
            : null,
        supportEmail,
        supportEmailSettingKey: key,
        howTo: desk.howTo,
        canSendAutomatically: caps.postComment || caps.raiseTicket,
      };
    });
  }
}
