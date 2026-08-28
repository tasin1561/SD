import { Injectable } from '@nestjs/common';
import type { CourierTrackingSource } from '../../courier-shared/services/courier-tracking-source';
import type {
  CourierTrackingResult,
  NormalizedScan,
} from '../../courier-delhivery/types/delhivery.types';
import { ShiprocketHttpService } from './shiprocket-http.service';
import { ShiprocketClientService } from './shiprocket-client.service';

/**
 * Shiprocket as a tracking source.
 *
 * ── THE TWO WAYS IT DIFFERS FROM DELHIVERY, BOTH DELIBERATE ──────────
 * `perAccount` is TRUE: their bearer token belongs to one account, and
 * an AWB booked on account B polled with account A's token comes back
 * as "not found" — which reads exactly like a parcel that has not moved.
 * The poller therefore groups by account before calling.
 *
 * `maxAwbsPerCall` is 1 because their track endpoint takes ONE AWB in
 * the path. The client loops internally, so the poller's batching still
 * works; setting this honestly is what keeps the poller's per-batch
 * failure isolation meaningful rather than an all-or-nothing call.
 */
@Injectable()
export class ShiprocketTrackingSourceService implements CourierTrackingSource {
  readonly courierCode = 'shiprocket';
  readonly maxAwbsPerCall = 25;
  readonly perAccount = true;
  readonly stubRemedy = 'Set courier.shiprocket_api_base_url — tracking is not running.';

  constructor(
    private readonly http: ShiprocketHttpService,
    private readonly client: ShiprocketClientService,
  ) {}

  async isStubMode(): Promise<boolean> {
    return this.http.isStubMode();
  }

  async fetchTracking(
    awbNumbers: readonly string[],
    courierAccountId: string | null,
  ): Promise<CourierTrackingResult[]> {
    if (courierAccountId === null) {
      // Not recoverable by retrying: without an account there is no
      // token, and picking a default one would poll the wrong contract.
      throw new Error('SHIPROCKET_TRACKING_NEEDS_ACCOUNT');
    }
    return this.client.fetchTracking(awbNumbers, courierAccountId);
  }

  normalizeScan(raw: { awbNumber: string; rawStatus: string; eventAtIso: string }): NormalizedScan {
    return this.client.normalizeScan(raw);
  }
}
