import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';

export interface EwaybillUpdateResult {
  readonly success: boolean;
  readonly awbNumber: string;
  readonly message: string | null;
  readonly raw: unknown;
}

/** Indian law requires an e-way bill above this consignment value. */
export const EWAYBILL_THRESHOLD_INR = 50_000;

/**
 * Attaching an e-way bill to a consignment.
 *
 * An e-way bill is a government document required for moving goods worth
 * more than ₹50 000 within India. Without one the consignment can be
 * detained in transit and penalised — this is a legal requirement, not a
 * courier preference, which is why `requiresEwaybill` exists as a plain
 * predicate the order flow can check rather than something buried here.
 *
 * The same endpoint updates the FORWARD e-way bill while the parcel is
 * moving out and the RETURN one once it is coming back; Delhivery picks
 * based on the shipment's current direction, so the caller does not
 * choose.
 */
@Injectable()
export class DelhiveryEwaybillService {
  private readonly logger = new Logger(DelhiveryEwaybillService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  /** Whether Indian law requires an e-way bill for this consignment. */
  requiresEwaybill(declaredValueInr: number): boolean {
    return declaredValueInr > EWAYBILL_THRESHOLD_INR;
  }

  async update(input: {
    readonly awbNumber: string;
    /** The invoice number the e-way bill was raised against. */
    readonly invoiceNumber: string;
    readonly ewaybillNumber: string;
  }): Promise<EwaybillUpdateResult> {
    if (await this.http.isStubMode()) {
      return { success: true, awbNumber: input.awbNumber, message: 'stub', raw: null };
    }
    await this.writeGuard.assertWritable('ewaybill.update', {
      awbNumber: input.awbNumber,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      method: 'PUT',
      path: `/api/rest/ewaybill/${encodeURIComponent(input.awbNumber)}/`,
      endpoint: 'ewaybill',
      encoding: 'json',
      body: {
        data: [{ dcn: input.invoiceNumber, ewbn: input.ewaybillNumber }],
      },
    });

    const message =
      (raw['error'] as string | undefined) ??
      (raw['rmk'] as string | undefined) ??
      null;
    const success = raw['error'] === undefined;
    if (!success) {
      this.logger.warn(
        { awbNumber: input.awbNumber, message },
        'E-waybill update rejected — a consignment over ₹50k can be detained without one',
      );
    }
    return { success, awbNumber: input.awbNumber, message, raw };
  }
}
