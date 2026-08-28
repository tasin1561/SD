import { Injectable } from '@nestjs/common';
import type { CourierTrackingSource } from '../../courier-shared/services/courier-tracking-source';
import type { CourierTrackingResult, NormalizedScan } from '../types/delhivery.types';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryTrackingFetchService } from './delhivery-tracking-fetch.service';
import { DelhiveryTrackingService } from './delhivery-tracking.service';

/**
 * Delhivery as a tracking source.
 *
 * A thin adapter over services that already existed — the poller used to
 * hold these three references directly, which was fine while there was
 * one courier and became the thing preventing a second.
 */
@Injectable()
export class DelhiveryTrackingSourceService implements CourierTrackingSource {
  readonly courierCode = 'delhivery';
  /** Their documented cap; exceeding it is rejected outright. */
  readonly maxAwbsPerCall = DelhiveryTrackingFetchService.MAX_WAYBILLS_PER_CALL;
  /** One set of credentials covers the estate. */
  readonly perAccount = false;
  readonly stubRemedy = 'Set courier.delhivery_api_base_url — tracking is not running.';

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly fetch: DelhiveryTrackingFetchService,
    private readonly normalizer: DelhiveryTrackingService,
  ) {}

  async isStubMode(): Promise<boolean> {
    return this.http.isStubMode();
  }

  async fetchTracking(awbNumbers: readonly string[]): Promise<CourierTrackingResult[]> {
    return this.fetch.fetchTracking([...awbNumbers], courierActor.runner('tracking-poll'));
  }

  normalizeScan(raw: { awbNumber: string; rawStatus: string; eventAtIso: string }): NormalizedScan {
    return this.normalizer.normalizeScan(raw);
  }
}
