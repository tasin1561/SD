import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicTrackingResponse } from '../dto/public-tracking.response.dto';
import { ExternalTrackingService } from './external-tracking.service';
import { PublicTrackingReadService } from './public-tracking-read.service';

/**
 * The public lookup entry point (owner decision 2026-11-22). Our own path is
 * tried FIRST and is byte-for-byte what it was; only a TRACKING_NOT_FOUND from
 * it falls through to the courier's public tracking. `findByAwb` itself is
 * untouched because the parcel assistant reads it directly.
 */
@Injectable()
export class PublicTrackingLookupService {
  constructor(
    private readonly own: PublicTrackingReadService,
    private readonly external: ExternalTrackingService,
  ) {}

  async lookup(awbNumber: string, clientIp: string | null): Promise<PublicTrackingResponse> {
    try {
      return { ...(await this.own.findByAwb(awbNumber)), source: 'SKYDROP' };
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      const found = await this.external.lookup(awbNumber.trim(), clientIp);
      if (found === null) throw err;
      return found;
    }
  }
}
