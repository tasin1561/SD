import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WHATSAPP_HOURLY_CAP_KEY } from '../whatsapp.constants';

export interface CourierWhatsappHealth {
  readonly readsToday: number;
  readonly failuresToday: number;
  readonly readsLastHour: number;
  readonly hourlyCap: number;
  /** Minutes the longest-waiting due parcel has been overdue; null = nothing due. */
  readonly oldestDueMinutes: number | null;
  readonly lastReadAt: string | null;
}

const IST_MS = 330 * 60 * 1000;
export const FAILED_OUTCOMES = ['FAILED', 'UNREADABLE', 'LOGGED_OUT'] as const;

/** Start of the current IST day, as an instant. */
export function istDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_MS);
}

@Injectable()
export class CourierWhatsappHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async hourlyCap(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: WHATSAPP_HOURLY_CAP_KEY },
      select: { valueInt: true },
    });
    return row?.valueInt ?? 400;
  }

  async snapshot(now = new Date()): Promise<CourierWhatsappHealth> {
    const day = istDayStart(now);
    const hour = new Date(now.getTime() - 60 * 60 * 1000);
    const [readsToday, failuresToday, readsLastHour, oldest, last, hourlyCap] = await Promise.all([
      this.prisma.client.courierWhatsappRead.count({ where: { at: { gte: day } } }),
      this.prisma.client.courierWhatsappRead.count({
        where: { at: { gte: day }, outcome: { in: [...FAILED_OUTCOMES] } },
      }),
      this.prisma.client.courierWhatsappRead.count({ where: { at: { gte: hour } } }),
      this.prisma.client.courierWhatsappCheck.findFirst({
        where: { nextReadAt: { lte: now } },
        orderBy: { nextReadAt: 'asc' },
        select: { nextReadAt: true },
      }),
      this.prisma.client.courierWhatsappRead.findFirst({
        orderBy: { at: 'desc' },
        select: { at: true },
      }),
      this.hourlyCap(),
    ]);
    return {
      readsToday,
      failuresToday,
      readsLastHour,
      hourlyCap,
      oldestDueMinutes:
        oldest?.nextReadAt == null
          ? null
          : Math.max(0, Math.round((now.getTime() - oldest.nextReadAt.getTime()) / 60_000)),
      lastReadAt: last?.at.toISOString() ?? null,
    };
  }
}
