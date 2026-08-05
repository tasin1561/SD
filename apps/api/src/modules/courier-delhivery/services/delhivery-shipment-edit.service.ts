import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface DelhiveryEditInput {
  readonly awbNumber: string;
  readonly name?: string;
  readonly phone?: string;
  readonly address?: string;
  readonly productsDesc?: string;
  /** Payment-mode conversion. See the conversion matrix below. */
  readonly paymentMode?: 'Prepaid' | 'COD';
  /** Mandatory when converting Prepaid → COD. */
  readonly codAmountInr?: string;
}

export interface DelhiveryEditResult {
  readonly success: boolean;
  readonly awbNumber: string;
  readonly message: string | null;
  readonly raw: unknown;
}

/**
 * Editing and cancelling a live consignment.
 *
 * Both go to the SAME endpoint (`POST /api/p/edit`); a cancellation is
 * just an edit carrying `cancellation: "true"`.
 *
 * ── WHAT DELHIVERY WILL AND WON'T ACCEPT ─────────────────────────────
 * Edits and cancels are only allowed in a narrow set of statuses, and
 * Delhivery is explicit that terminal and dispatched states are closed:
 *
 *   Forward (COD/Prepaid): Manifested, In Transit, Pending
 *   RVP (Pickup):          Scheduled
 *   REPL:                  Manifested, In Transit, Pending
 *   Never:                 Dispatched, Delivered, DTO, RTO, LOST, Closed
 *
 * Cancelling has a side effect worth knowing before you call it: a
 * Manifested parcel stays Manifested (nothing was collected); one that is
 * In Transit or Pending stays In Transit but flips to status type RT —
 * i.e. **cancelling a moving parcel turns it into a return**, it does not
 * make it disappear. A Scheduled reverse pickup becomes Canceled (CN).
 *
 * Payment-mode conversion has its own rules: COD→Prepaid is allowed,
 * Prepaid→COD is allowed but the COD amount becomes mandatory, and
 * same-to-same, anything involving Pickup, and anything involving REPL
 * are all refused. We check the ones we can check locally rather than
 * discovering them from a rejection.
 */
@Injectable()
export class DelhiveryShipmentEditService {
  private readonly logger = new Logger(DelhiveryShipmentEditService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  async edit(
    input: DelhiveryEditInput,
    actor?: CourierCredentialActor,
  ): Promise<DelhiveryEditResult> {
    if (input.paymentMode === 'COD' && input.codAmountInr === undefined) {
      // Delhivery would reject this; failing here says why.
      throw new Error(
        'Converting a shipment to COD requires codAmountInr (Delhivery rejects the edit otherwise)',
      );
    }
    if (await this.http.isStubMode()) {
      return { success: true, awbNumber: input.awbNumber, message: 'stub', raw: null };
    }
    await this.writeGuard.assertWritable('shipment.edit', {
      awbNumber: input.awbNumber,
      fields: Object.keys(input).filter((k) => k !== 'awbNumber'),
    });

    const body: Record<string, unknown> = { waybill: input.awbNumber };
    if (input.name !== undefined) body['name'] = input.name;
    if (input.phone !== undefined) body['phone'] = input.phone;
    if (input.address !== undefined) body['add'] = input.address;
    if (input.productsDesc !== undefined) body['products_desc'] = input.productsDesc;
    if (input.paymentMode !== undefined) body['pt'] = input.paymentMode;
    if (input.codAmountInr !== undefined) body['cod_amount'] = input.codAmountInr;

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      method: 'POST',
      path: '/api/p/edit',
      endpoint: 'edit',
      encoding: 'json',
      body,
    });
    return this.interpret(input.awbNumber, raw);
  }

  /**
   * Cancel a consignment.
   *
   * Note the semantics above: this does not vaporise a parcel already in
   * the network — it converts it to a return. The caller's order state
   * has to reflect that, which is why the result is surfaced rather than
   * swallowed.
   */
  async cancel(awbNumber: string, actor?: CourierCredentialActor): Promise<DelhiveryEditResult> {
    if (await this.http.isStubMode()) {
      return { success: true, awbNumber, message: 'stub', raw: null };
    }
    await this.writeGuard.assertWritable('shipment.cancel', { awbNumber });

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      method: 'POST',
      path: '/api/p/edit',
      endpoint: 'edit',
      encoding: 'json',
      body: { waybill: awbNumber, cancellation: 'true' },
    });
    const result = this.interpret(awbNumber, raw);
    if (result.success) {
      this.logger.log(
        { awbNumber },
        'Delhivery consignment cancelled (a moving parcel becomes an RT return, not a disappearance)',
      );
    }
    return result;
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * Delhivery answers HTTP 200 and signals failure in the body — verified
   * on tracking, and the edit endpoint follows the same house style. So
   * `res.ok` is not the answer; the body is.
   */
  private interpret(awbNumber: string, raw: Record<string, unknown>): DelhiveryEditResult {
    const success =
      raw['status'] === true ||
      raw['success'] === true ||
      (raw['error'] === undefined && raw['status'] === undefined && raw['success'] === undefined);
    const message =
      (raw['remark'] as string | undefined) ??
      (raw['rmk'] as string | undefined) ??
      (raw['error'] as string | undefined) ??
      null;

    if (!success) {
      this.logger.warn({ awbNumber, message }, 'Delhivery edit/cancel rejected');
    }
    return { success, awbNumber, message, raw };
  }
}
