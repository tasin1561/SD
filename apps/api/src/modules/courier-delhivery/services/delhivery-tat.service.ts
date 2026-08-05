import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export type DelhiveryTransportMode = 'S' | 'E' | 'N';

export interface DelhiveryTatResult {
  /** Working days from handover to delivery. */
  readonly tatDays: number | null;
  readonly mode: DelhiveryTransportMode;
  readonly fromLiveApi: boolean;
  /** Present when Delhivery declined to answer for this lane. */
  readonly message: string | null;
}

/**
 * Expected TAT (turnaround time) between two pincodes.
 *
 * Verified against production 2026-07-27:
 *   GET /api/dc/expected_tat?origin_pin=&destination_pin=&mot=S&pdt=B2C
 *   → {"success":true,"msg":"","data":{"tat":5}}
 *
 * Delhi (110042) → Bangalore (560001) by surface came back as 5 days.
 *
 * This is what lets the public tracking page and the seller dashboard
 * show a promised date instead of "in transit, who knows". Delhivery's
 * caveats are worth keeping in mind and are the reason we store this as
 * an ESTIMATE rather than a commitment: the number reflects current
 * network performance, lanes have their own cutoffs, and a date landing
 * on a Sunday or holiday rolls forward.
 */
@Injectable()
export class DelhiveryTatService {
  private readonly logger = new Logger(DelhiveryTatService.name);

  constructor(private readonly http: DelhiveryHttpService) {}

  async expectedTat(
    input: {
      originPin: string;
      destinationPin: string;
      mode?: DelhiveryTransportMode;
      /** "YYYY-MM-DD HH:mm" — shifts the answer to a real expected date. */
      expectedPickupAt?: string;
    },
    actor?: CourierCredentialActor,
  ): Promise<DelhiveryTatResult> {
    const mode = input.mode ?? 'S';
    if (await this.http.isStubMode()) {
      return { tatDays: 3, mode, fromLiveApi: false, message: null };
    }

    const qs = new URLSearchParams({
      origin_pin: input.originPin,
      destination_pin: input.destinationPin,
      mot: mode,
      pdt: 'B2C',
    });
    if (input.expectedPickupAt !== undefined) {
      qs.set('expected_pickup_date', input.expectedPickupAt);
    }

    const res = await this.http.request<{
      success?: boolean;
      msg?: string;
      data?: { tat?: number };
    }>({
      actor,
      method: 'GET',
      path: `/api/dc/expected_tat?${qs.toString()}`,
      endpoint: 'tat',
    });

    if (res.success !== true) {
      this.logger.warn(
        { ...input, msg: res.msg },
        'Delhivery declined to give a TAT for this lane',
      );
      return {
        tatDays: null,
        mode,
        fromLiveApi: true,
        message: res.msg ?? 'No TAT available for this lane',
      };
    }
    return {
      tatDays: res.data?.tat ?? null,
      mode,
      fromLiveApi: true,
      message: null,
    };
  }
}
