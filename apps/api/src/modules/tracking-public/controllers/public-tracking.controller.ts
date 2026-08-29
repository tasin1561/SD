import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { Throttle, minutes } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { ThrottleSetting } from '../../../common/throttler/throttle-setting.decorator';
import { PublicTrackingReadService } from '../services/public-tracking-read.service';
import type { PublicTrackingResponse } from '../dto/public-tracking.response.dto';

/**
 * Module 10 (TRK-8) — open public AWB tracking lookup. NO auth: the
 * AWB is the access token. The defense surface is the trio:
 *
 *   - HMAC + signature scheme on the webhook receiver (TRK-1) keeps
 *     spoofed scans out, so a published AWB can't be used to inject
 *     bogus timeline events.
 *   - The customer-safe projection (PublicTrackingReadService) keeps
 *     internal IDs / PII / cross-order data off the wire.
 *   - The rate limit here keeps bulk enumeration of AWBs cost-
 *     prohibitive.
 *
 * Rate limit
 *   Per-IP, `tracking.public_lookup_rate_limit_per_min` per minute,
 *   read from `system_settings` and changeable without a redeploy
 *   (@ThrottleSetting). The number on @Throttle is NOT dead — it is
 *   the fallback that applies whenever the setting cannot be read or
 *   is not a positive integer, because a settings problem must never
 *   be able to REMOVE the limit from the one endpoint open to the
 *   internet.
 *
 *   The lookup is memoised for 60s per instance, which is what makes
 *   it affordable: a naive dynamic limit means a database read on
 *   every anonymous request, so the flood the limit exists to stop
 *   becomes a flood against the database and the limiter is the
 *   attack surface. A legitimate customer hits refresh a handful of
 *   times; bulk enumeration triggers throttling.
 *
 * Endpoint shape — `GET /public/tracking/:awbNumber`. Returns 200
 * with the projection on hit, 404 with a single generic message on
 * miss. The same 404 fires whether the AWB is unknown, the shipment
 * was soft-deleted, the courier was soft-deleted, or the AWB hasn't
 * been issued yet — anti-enumeration discipline.
 *
 * Internationalization — the response carries enum-style status
 * strings (PublicShipmentDisplayStatus). The deferred apps/track
 * frontend owns EN/HI localized copy; the API is i18n-neutral.
 */
@ApiTags('public-tracking')
@ThrottleKey('ip')
@Throttle({ default: { limit: 30, ttl: minutes(1) } })
@ThrottleSetting('tracking.public_lookup_rate_limit_per_min')
@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly read: PublicTrackingReadService) {}

  @Get(':awbNumber')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'TRK-8 — open AWB tracking lookup. NO auth (the AWB is the access token). Customer-safe projection only: no internal IDs, no PII, no cross-order data. 404 message is identical for unknown / deleted / unissued AWBs (anti-enumeration). Per-IP rate limit applies.',
  })
  async lookup(@Param('awbNumber') awbNumber: string): Promise<PublicTrackingResponse> {
    return this.read.findByAwb(awbNumber);
  }
}
