import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryShipmentEditService } from '../../courier-delhivery/services/delhivery-shipment-edit.service';
import { DelhiveryPickupService } from '../../courier-delhivery/services/delhivery-pickup.service';
import { DelhiveryWarehouseService } from '../../courier-delhivery/services/delhivery-warehouse.service';
import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';
import { DelhiveryHttpService } from '../../courier-delhivery/services/delhivery-http.service';
import { ShiprocketHttpService } from '../../courier-shiprocket/services/shiprocket-http.service';
import { EnvService } from '../../../config/env.service';

export interface OpsActionResult {
  readonly success: boolean;
  readonly message: string | null;
}

export interface PickupDispatchInput {
  readonly courierCode: string;
  readonly courierAccountId: string | null;
  /** Must match a location registered with THAT courier, exactly. */
  readonly pickupLocation: string;
  readonly pickupDate: string;
  readonly pickupTime: string;
  readonly expectedPackageCount: number;
  /** Shiprocket schedules a pickup for a specific parcel, not for a
   *  location and a day — see the note on `requestPickup` below. */
  readonly courierShipmentIds: readonly string[];
}

export interface WarehouseDispatchInput {
  readonly courierCode: string;
  readonly courierAccountId: string | null;
  readonly name: string;
  readonly phone: string;
  readonly pin: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly email: string;
  /** Where undelivered parcels come back to; may equal the pickup
   *  address. Delhivery requires it; Shiprocket takes the pickup
   *  address as the return address, so it is unused there. */
  readonly returnAddress: string;
}

const manualCourier = (courierCode: string, verb: string): OpsActionResult => ({
  success: false,
  message: `${courierCode} is booked by hand — ${verb} directly with them`,
});

/**
 * The physical-world courier actions, whichever courier has the parcel.
 *
 * Same reasoning as the AWB and NDR dispatchers: `courier-ops` owns the
 * things that must happen identically — the audit row, the operator
 * attribution, the one-open-pickup-per-location-per-day claim — and
 * none of that should be written twice with a chance of drifting.
 *
 * ── THE ONE ASYMMETRY WORTH KNOWING ABOUT ────────────────────────────
 * Delhivery schedules a pickup for a LOCATION and a DAY: one request
 * covers every parcel waiting there, which is why our
 * `courier_pickup_requests` row is keyed on (courier, warehouse, date).
 * Shiprocket schedules per PARCEL. So a Shiprocket "pickup" is a loop
 * over the day's parcels, and it reports partial success honestly
 * rather than collapsing to a boolean — twelve of fifteen parcels
 * scheduled is a real state an operator has to be able to see.
 */
@Injectable()
export class CourierOpsDispatchService {
  private readonly logger = new Logger(CourierOpsDispatchService.name);

  constructor(
    private readonly delhiveryEdit: DelhiveryShipmentEditService,
    private readonly delhiveryPickup: DelhiveryPickupService,
    private readonly delhiveryWarehouse: DelhiveryWarehouseService,
    private readonly shiprocket: ShiprocketClientService,
    private readonly delhiveryHttp: DelhiveryHttpService,
    private readonly shiprocketHttp: ShiprocketHttpService,
    private readonly env: EnvService,
  ) {}

  /**
   * In production, is this courier answering from its STUB? A stub
   * reports every write as a success before any guard runs (Delhivery's
   * edit/cancel, Shiprocket's cancel), so a write it "accepts" never
   * reached the courier — and anything we RECORD on the strength of that
   * reply is false. The same rule the label leg applies (COURIER_STUBBED,
   * CUR-15's spirit): outside production a stub is the point.
   */
  async isStubbedInProduction(courierCode: string): Promise<boolean> {
    if (!this.env.isProduction) return false;
    switch (courierCode) {
      case 'delhivery':
        return this.delhiveryHttp.isStubMode();
      case 'shiprocket':
        return this.shiprocketHttp.isStubMode();
      default:
        return false;
    }
  }

  /** Cancel a live consignment. */
  async cancel(
    courierCode: string,
    courierAccountId: string | null,
    awbNumber: string,
    actor: CourierCredentialActor,
  ): Promise<OpsActionResult> {
    switch (courierCode) {
      case 'shiprocket': {
        if (courierAccountId === null) {
          return { success: false, message: 'No Shiprocket account recorded on this shipment' };
        }
        const r = await this.shiprocket.cancelShipment(awbNumber, courierAccountId);
        return { success: r.ok, message: r.message };
      }
      case 'delhivery': {
        const r = await this.delhiveryEdit.cancel(awbNumber, actor);
        return { success: r.success, message: r.message };
      }
      default:
        return manualCourier(courierCode, 'cancel it');
    }
  }

  /**
   * Correct the consignee details on a live parcel.
   *
   * `productsDesc` is Delhivery-only: Shiprocket has no field for it and
   * dropping it silently would let an operator believe they had changed
   * something they had not.
   */
  async edit(
    input: {
      readonly courierCode: string;
      readonly courierAccountId: string | null;
      readonly courierShipmentId: string | null;
      /** Shiprocket's address update keys on their ORDER id, not the
       *  parcel id — the parcel id is refused as invalid. */
      readonly courierOrderId?: string | null;
      /** The destination as it stands. Their endpoint validates the
       *  whole shipping block, so a one-line edit is merged over this. */
      readonly currentDestination?: {
        readonly name: string;
        readonly addressLine1: string;
        readonly addressLine2: string | null;
        readonly city: string;
        readonly stateProvince: string;
        readonly postalCode: string;
        readonly phoneE164: string;
        readonly email: string | null;
      };
      readonly awbNumber: string;
      readonly name?: string;
      readonly phone?: string;
      readonly address?: string;
      readonly productsDesc?: string;
    },
    actor: CourierCredentialActor,
  ): Promise<OpsActionResult> {
    switch (input.courierCode) {
      case 'shiprocket': {
        if (
          input.courierAccountId === null ||
          input.courierOrderId === null ||
          input.courierOrderId === undefined ||
          input.currentDestination === undefined
        ) {
          // Named separately from the parcel id, because the ORDER id is
          // the one their address endpoint keys on and a parcel booked
          // before we started persisting it has none.
          return {
            success: false,
            message:
              'This parcel carries no Shiprocket order id, so their address endpoint cannot ' +
              'address it. Change it in their panel, or cancel and rebook.',
          };
        }
        /*
          THE DESCRIPTION CANNOT CHANGE, BUT THE REST STILL CAN.

          Measured against the live API on 2026-09-09, because the old
          claim came from their docs and the NDR path had already proved
          those wrong once:

            update/adhoc BEFORE an AWB  → 200, the name changes, and
              every field we did not send is PRESERVED (they answer
              `partially_update` and name what they refused)
            update/adhoc AFTER an AWB   → 400 "Order update not allowed"

          Our edit path only ever runs on a parcel that HAS a waybill, so
          the refusal is real rather than assumed. What was wrong was the
          BLAST RADIUS: this refused the entire edit whenever a
          description was included, so an operator correcting a wrong
          flat number AND tidying the description lost the flat number
          too — the part that would have worked.

          Now the consignee half is applied and the description is
          reported as the one thing that did not land. That mirrors
          Shiprocket's own `not_updated_fields` shape, which is the right
          instinct: say precisely what did not happen instead of refusing
          everything.
        */
        const consigneeChanged =
          input.name !== undefined || input.phone !== undefined || input.address !== undefined;
        if (input.productsDesc !== undefined && !consigneeChanged) {
          return {
            success: false,
            message:
              'Shiprocket will not change a product description once a waybill exists ' +
              '("Order update not allowed"). Cancel and rebook if it must change.',
          };
        }
        const r = await this.shiprocket.editShipment(
          {
            courierOrderId: input.courierOrderId,
            current: input.currentDestination,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.phone === undefined ? {} : { phone: input.phone }),
            ...(input.address === undefined ? {} : { address: input.address }),
          },
          input.courierAccountId,
        );
        if (input.productsDesc !== undefined) {
          // Partial: whatever the consignee edit did, plus the honest
          // note. Reported as a FAILURE when the consignee edit itself
          // failed, so a half-applied change never reads as done.
          return {
            success: r.ok,
            message:
              `${r.message ?? 'Consignee details updated.'} The product description was NOT ` +
              'changed — Shiprocket refuses that once a waybill exists. Cancel and rebook if it must change.',
          };
        }
        return { success: r.ok, message: r.message };
      }
      case 'delhivery': {
        const r = await this.delhiveryEdit.edit(
          {
            awbNumber: input.awbNumber,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.phone === undefined ? {} : { phone: input.phone }),
            ...(input.address === undefined ? {} : { address: input.address }),
            ...(input.productsDesc === undefined ? {} : { productsDesc: input.productsDesc }),
          },
          actor,
        );
        return { success: r.success, message: r.message };
      }
      default:
        return manualCourier(input.courierCode, 'change the address');
    }
  }

  /**
   * Ask for a collection.
   *
   * Delhivery: one call for the location and day. Shiprocket: one call
   * per parcel, so the result counts what actually got scheduled.
   */
  async requestPickup(
    input: PickupDispatchInput,
    actor: CourierCredentialActor,
  ): Promise<OpsActionResult & { pickupId: string | null; scheduled: number; failed: number }> {
    switch (input.courierCode) {
      case 'shiprocket': {
        if (input.courierAccountId === null) {
          return {
            success: false,
            message: 'No Shiprocket account recorded for this pickup',
            pickupId: null,
            scheduled: 0,
            failed: 0,
          };
        }
        let scheduled = 0;
        let failed = 0;
        const problems: string[] = [];
        for (const id of input.courierShipmentIds) {
          try {
            const r = await this.shiprocket.requestPickup(id, input.courierAccountId);
            if (r.ok) scheduled += 1;
            else {
              failed += 1;
              if (r.message !== null) problems.push(r.message);
            }
          } catch (err) {
            // One parcel failing must not lose the rest of the day's
            // collection — the van is still coming for the others.
            failed += 1;
            problems.push(err instanceof Error ? err.message : String(err));
            this.logger.warn(
              { courierShipmentId: id, err: problems[problems.length - 1] },
              'Shiprocket pickup failed for one parcel; continuing',
            );
          }
        }
        return {
          // ANY parcel scheduled means a van is coming, which is the
          // fact the pickup row records. The counts carry the rest.
          success: scheduled > 0,
          message:
            failed === 0
              ? null
              : `${scheduled} scheduled, ${failed} failed${problems.length > 0 ? `: ${problems[0]}` : ''}`,
          pickupId: null,
          scheduled,
          failed,
        };
      }
      case 'delhivery': {
        const r = await this.delhiveryPickup.requestPickup(
          {
            pickupLocation: input.pickupLocation,
            pickupDate: input.pickupDate,
            pickupTime: input.pickupTime,
            expectedPackageCount: input.expectedPackageCount,
          },
          actor,
        );
        return {
          success: r.success,
          message: r.message,
          pickupId: r.pickupId,
          // Delhivery's single request covers every parcel at the
          // location, so the count is what we told them to expect.
          scheduled: r.success ? input.expectedPackageCount : 0,
          failed: r.success ? 0 : input.expectedPackageCount,
        };
      }
      default:
        return {
          ...manualCourier(input.courierCode, 'arrange the collection'),
          pickupId: null,
          scheduled: 0,
          failed: 0,
        };
    }
  }

  /**
   * Register a pickup location on the courier's own account.
   *
   * Both couriers match the name EXACTLY on every shipment they create,
   * and neither offers a "list my locations" endpoint to discover a
   * typo from — so a wrong name here is found when parcels stop being
   * accepted, not when it is entered.
   */
  async registerWarehouse(
    input: WarehouseDispatchInput,
    actor: CourierCredentialActor,
  ): Promise<OpsActionResult> {
    switch (input.courierCode) {
      case 'shiprocket': {
        if (input.courierAccountId === null) {
          return { success: false, message: 'No Shiprocket account selected' };
        }
        const r = await this.shiprocket.registerPickupLocation(
          {
            name: input.name,
            phone: input.phone,
            pin: input.pin,
            address: input.address,
            city: input.city,
            state: input.state,
            country: input.country,
            email: input.email,
          },
          input.courierAccountId,
        );
        return { success: r.success, message: r.message };
      }
      case 'delhivery': {
        const r = await this.delhiveryWarehouse.register(
          {
            name: input.name,
            phone: input.phone,
            pin: input.pin,
            address: input.address,
            city: input.city,
            country: input.country,
            email: input.email,
            returnAddress: input.returnAddress,
          },
          actor,
          input.courierAccountId,
        );
        return { success: r.success, message: r.message };
      }
      default:
        return manualCourier(input.courierCode, 'register the location');
    }
  }
}
