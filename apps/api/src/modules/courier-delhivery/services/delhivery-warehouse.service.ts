import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface DelhiveryWarehouseInput {
  /**
   * THE load-bearing string. Delhivery matches it case- and
   * space-sensitively against `pickup_location.name` on every shipment
   * create, and it cannot be changed after registration.
   */
  readonly name: string;
  readonly phone: string;
  readonly pin: string;
  readonly address?: string;
  readonly city?: string;
  readonly country?: string;
  readonly email?: string;
  readonly registeredName?: string;
  /** Where undelivered parcels come back to; may equal the pickup address. */
  readonly returnAddress: string;
  readonly returnCity?: string;
  readonly returnPin?: string;
  readonly returnState?: string;
  readonly returnCountry?: string;
}

export interface DelhiveryWarehouseResult {
  readonly success: boolean;
  readonly name: string;
  readonly message: string | null;
  readonly raw: unknown;
}

/**
 * Registering a Skydrop warehouse as a Delhivery pickup location.
 *
 * ── WHY THE NAME MATTERS MORE THAN ANYTHING ELSE HERE ────────────────
 * Every shipment create sends `pickup_location: { name }`, and Delhivery
 * matches that string **exactly** — case and spaces included. A trailing
 * space or a lowercase letter is not a warning, it is a rejected
 * manifest. The name also cannot be changed after registration (the edit
 * API takes the name as the key and updates everything else), so getting
 * it right the first time is the whole game.
 *
 * There is no read-only "list my warehouses" endpoint, which means the
 * only ways to confirm a registered name are the Delhivery One panel or
 * a create attempt. Worth knowing before assuming a name is right.
 *
 * Both operations are physical-world writes against the live account, so
 * both are gated (there is no sandbox for this account).
 */
@Injectable()
export class DelhiveryWarehouseService {
  private readonly logger = new Logger(DelhiveryWarehouseService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  async register(
    input: DelhiveryWarehouseInput,
    actor?: CourierCredentialActor,
    courierAccountId?: string | null,
  ): Promise<DelhiveryWarehouseResult> {
    this.assertName(input.name);
    if (await this.http.isStubMode()) {
      return { success: true, name: input.name, message: 'stub', raw: null };
    }
    await this.writeGuard.assertWritable('warehouse.write', {
      operation: 'create',
      name: input.name,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      courierAccountId,
      method: 'POST',
      path: '/api/backend/clientwarehouse/create/',
      endpoint: 'warehouse',
      encoding: 'json',
      body: this.payload(input),
    });
    return this.interpret(input.name, raw);
  }

  /** Update an existing location. The NAME is the key and is immutable. */
  async update(
    input: DelhiveryWarehouseInput,
    actor?: CourierCredentialActor,
    courierAccountId?: string | null,
  ): Promise<DelhiveryWarehouseResult> {
    this.assertName(input.name);
    if (await this.http.isStubMode()) {
      return { success: true, name: input.name, message: 'stub', raw: null };
    }
    await this.writeGuard.assertWritable('warehouse.write', {
      operation: 'edit',
      name: input.name,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      courierAccountId,
      method: 'POST',
      path: '/api/backend/clientwarehouse/edit/',
      endpoint: 'warehouse',
      encoding: 'json',
      body: this.payload(input),
    });
    return this.interpret(input.name, raw);
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * Catch the mistake that is invisible in a config file and fatal at
   * manifest time.
   */
  private assertName(name: string): void {
    if (name !== name.trim()) {
      throw new Error(
        `Delhivery pickup location '${name}' has leading/trailing whitespace. ` +
          `The name is matched exactly on every shipment create, so this would ` +
          `reject every manifest from this warehouse.`,
      );
    }
    if (name === '') {
      throw new Error('Delhivery pickup location name cannot be empty');
    }
  }

  private payload(input: DelhiveryWarehouseInput): Record<string, unknown> {
    return {
      name: input.name,
      phone: input.phone,
      pin: input.pin,
      address: input.address ?? '',
      city: input.city ?? '',
      country: input.country ?? 'India',
      email: input.email ?? '',
      registered_name: input.registeredName ?? input.name,
      return_address: input.returnAddress,
      return_city: input.returnCity ?? input.city ?? '',
      return_pin: input.returnPin ?? input.pin,
      return_state: input.returnState ?? '',
      return_country: input.returnCountry ?? 'India',
    };
  }

  /**
   * Delhivery signals failure in the BODY while still answering 200 —
   * verified on the tracking endpoint, and the warehouse endpoints follow
   * the same house style. Treating HTTP 200 as success would mark a
   * failed registration as done and only surface it as a rejected
   * manifest later.
   */
  private interpret(name: string, raw: Record<string, unknown>): DelhiveryWarehouseResult {
    const success =
      raw['success'] === true || (raw['success'] === undefined && raw['error'] === undefined);
    const message =
      (raw['error'] as string | undefined) ??
      (raw['message'] as string | undefined) ??
      (raw['rmk'] as string | undefined) ??
      null;

    if (!success) {
      this.logger.warn({ name, message }, 'Delhivery warehouse write rejected');
    }
    return { success, name, message, raw };
  }
}
