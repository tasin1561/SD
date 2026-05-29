import { Injectable } from '@nestjs/common';
import { ServiceArea } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * PIN → ServiceArea → ZoneMatrix resolver. Returns the zone string
 * for a (courier, destination PIN) pair, plus the resolved
 * ServiceArea for surcharge filtering.
 *
 * Fallback strategy:
 *   - PIN row missing → returns { serviceArea: null, zone: null }.
 *   - PIN row present but `serviceArea` null → same.
 *   - ZoneMatrixEntry missing for the courier+area → returns the
 *     PIN's `zone` if set (some seeds keep per-PIN zone directly),
 *     else { zone: null }.
 *   - Caller treats `zone === null` as "fall back to DEFAULT" string.
 *
 * Phase 1A assumes ORIGIN = METRO (BLR-01 — the single seeded
 * warehouse). The zone matrix is keyed on (courier, origin, dest);
 * a future multi-warehouse setup needs to pass the origin in.
 */

export interface ZoneResolveInput {
  readonly pinCode: string;
  readonly countryCode?: string;
  readonly courierId: string | null;
}

export interface ZoneResolution {
  readonly serviceArea: ServiceArea | null;
  readonly zone: string | null;
}

const PHASE_1A_ORIGIN_AREA: ServiceArea = ServiceArea.METRO;

@Injectable()
export class ZoneResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: ZoneResolveInput): Promise<ZoneResolution> {
    const pin = await this.prisma.client.pinCode.findUnique({
      where: { pinCode: input.pinCode },
    });
    if (!pin) return { serviceArea: null, zone: null };

    const destArea = pin.serviceArea ?? null;
    if (!destArea) return { serviceArea: null, zone: pin.zone };

    if (!input.courierId) {
      return { serviceArea: destArea, zone: pin.zone };
    }

    const matrixEntry = await this.prisma.client.zoneMatrixEntry.findUnique({
      where: {
        courierId_originArea_destArea: {
          courierId: input.courierId,
          originArea: PHASE_1A_ORIGIN_AREA,
          destArea,
        },
      },
    });

    if (matrixEntry) {
      return { serviceArea: destArea, zone: matrixEntry.zone };
    }
    // No matrix entry — fall back to the PIN's own zone (if seeded).
    return { serviceArea: destArea, zone: pin.zone };
  }
}
