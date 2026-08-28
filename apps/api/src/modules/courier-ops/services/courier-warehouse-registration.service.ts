import { CourierOpsDispatchService } from './courier-ops-dispatch.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import {
  DelhiveryWarehouseService,
  type DelhiveryWarehouseInput,
} from '../../courier-delhivery/services/delhivery-warehouse.service';

export interface WarehouseRegistrationOutcome {
  readonly success: boolean;
  readonly name: string;
  readonly message: string | null;
}

/**
 * Registering a warehouse with Delhivery as a pickup location.
 *
 * ── THE NAME IS THE WHOLE GAME ───────────────────────────────────────
 * Every shipment create sends `pickup_location: { name }` and Delhivery
 * matches it EXACTLY — case and spaces included. A trailing space is not
 * a warning, it is a rejected manifest. Worse, the name cannot be
 * changed after registration: their edit API takes it as the key and
 * updates everything else around it.
 *
 * There is also no "list my warehouses" endpoint, so the only ways to
 * check a registered name are their panel or a create attempt. Getting
 * it right the first time is not a nicety.
 *
 * This service therefore refuses a name that differs from itself
 * trimmed, before anything reaches the wire — the adapter checks the
 * same thing, and the duplication is deliberate: a name with a trailing
 * space that reached Delhivery would be permanently wrong.
 *
 * ── WHY THE ADDRESS IS PASSED IN, NOT READ FROM THE WAREHOUSE ────────
 * Our `warehouses` table carries no address at all — just a code, a
 * name and a timezone. Inventing a schema for it as a side effect of
 * this endpoint would be the wrong place to make that decision, so the
 * operator supplies the address once at registration, where they are
 * already reading it off the paperwork. When multi-warehouse routing
 * makes an address column genuinely necessary, this is the caller that
 * should switch to reading it.
 */
@Injectable()
export class CourierWarehouseRegistrationService {
  constructor(
    private readonly audit: AuditLogService,
    private readonly warehouses: DelhiveryWarehouseService,
    private readonly opsDispatch: CourierOpsDispatchService,
  ) {}

  /**
   * `courierAccountId` decides WHICH Delhivery account the warehouse is
   * registered with, and a pickup location only exists inside the
   * account that registered it. Two accounts collecting from the same
   * physical building each need their own registration — so this is not
   * an optional refinement, it is which company you are talking to.
   *
   * Null registers under the default/legacy credential, which is the
   * single-account case.
   */
  async register(
    staffId: string,
    input: DelhiveryWarehouseInput,
    ctx: ClientInfoPayload,
    courierAccountId: string | null = null,
    /** Defaults to Delhivery so existing callers are unchanged. A
     *  building known to both couriers needs registering with BOTH —
     *  they each keep their own list and neither can see the other's. */
    courierCode = 'delhivery',
  ): Promise<WarehouseRegistrationOutcome> {
    this.assertExactName(input.name);
    const result = await this.opsDispatch.registerWarehouse(
      {
        courierCode,
        courierAccountId,
        name: input.name,
        phone: input.phone,
        pin: input.pin,
        address: input.address ?? '',
        city: input.city ?? '',
        // Shiprocket requires a state; Delhivery derives it from the
        // pin and ignores what it is sent.
        state: input.state ?? '',
        country: input.country ?? 'India',
        email: input.email ?? '',
        returnAddress: input.returnAddress,
      },
      courierActor.operator(staffId),
    );
    await this.auditIt(staffId, 'registered', input.name, result, ctx);
    return { success: result.success, name: input.name, message: result.message };
  }

  /**
   * Amend a registered location.
   *
   * DELHIVERY ONLY, deliberately and by name: Shiprocket's API has an
   * add-pickup-location endpoint and no edit. Silently routing an update
   * to `addpickup` would create a SECOND location with the same name —
   * and the name is what every manifest matches on, so which one a
   * parcel books against becomes unanswerable.
   */
  async update(
    staffId: string,
    input: DelhiveryWarehouseInput,
    ctx: ClientInfoPayload,
    courierAccountId: string | null = null,
    courierCode = 'delhivery',
  ): Promise<WarehouseRegistrationOutcome> {
    this.assertExactName(input.name);
    if (courierCode !== 'delhivery') {
      return {
        success: false,
        name: input.name,
        message: `${courierCode} cannot amend a registered pickup location — add a new one with a new name, or change it in their panel.`,
      };
    }
    const result = await this.warehouses.update(
      input,
      courierActor.operator(staffId),
      courierAccountId,
    );
    await this.auditIt(staffId, 'updated', input.name, result, ctx);
    return { success: result.success, name: result.name, message: result.message };
  }

  /**
   * A name that is not identical to its own trimmed form is refused.
   *
   * This looks pedantic and is not: the string is matched
   * character-for-character on every subsequent manifest, and it cannot
   * be corrected afterwards.
   */
  private assertExactName(name: string): void {
    if (name !== name.trim() || name === '') {
      throw new BadRequestException({
        code: 'PICKUP_LOCATION_NAME_NOT_EXACT',
        message:
          'The pickup location name has leading or trailing whitespace. Delhivery matches this string exactly on every shipment and the name cannot be changed after registration, so a stray space would permanently break manifesting.',
      });
    }
  }

  private async auditIt(
    staffId: string,
    verb: 'registered' | 'updated',
    name: string,
    result: { success: boolean; message: string | null },
    ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: `courier.warehouse.${verb}`,
      entityType: 'courier_warehouse',
      entityId: name,
      // HIGH on register: the name becomes permanent at the courier and
      // every future manifest depends on it matching.
      severity: verb === 'registered' ? 'HIGH' : 'MEDIUM',
      metadata: {
        pickupLocationName: name,
        success: result.success,
        courierMessage: result.message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  }
}
