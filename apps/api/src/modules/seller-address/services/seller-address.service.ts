import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AddressOwnerType,
  AddressType,
  OnboardingStepActor,
  Prisma,
  SellerOnboardingStep,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SellerOnboardingService } from '../../seller-onboarding/services/seller-onboarding.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateSellerAddressDto } from '../dto/create-address.dto';
import type { UpdateSellerAddressDto } from '../dto/update-address.dto';

const COUNTRY_BY_TYPE: Record<AddressType, string> = {
  [AddressType.BD_ORIGIN]: 'BD',
  [AddressType.BD_OFFICE]: 'BD',
  [AddressType.IN_RETURN]: 'IN',
  [AddressType.IN_WAREHOUSE]: 'IN',
  [AddressType.RECIPIENT]: '__',
};

const SELLER_OWNED_TYPES: AddressType[] = [
  AddressType.BD_ORIGIN,
  AddressType.BD_OFFICE,
  AddressType.IN_RETURN,
];

const E164_BD = /^\+880\d{9,12}$/;
const E164_IN = /^\+91\d{10}$/;
const POSTAL_BD = /^\d{4}$/;
const POSTAL_IN = /^\d{6}$/;

const ONBOARDING_STEP_FOR_TYPE: Partial<Record<AddressType, SellerOnboardingStep>> = {
  [AddressType.BD_ORIGIN]: SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
  [AddressType.IN_RETURN]: SellerOnboardingStep.IN_RETURN_ADDRESS_ADDED,
  [AddressType.BD_OFFICE]: SellerOnboardingStep.BD_OFFICE_ADDRESS_ADDED,
};

export interface SellerAddressView {
  id: string;
  type: AddressType;
  label: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  type: true,
  label: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  stateProvince: true,
  postalCode: true,
  countryCode: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class SellerAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly onboarding: SellerOnboardingService,
  ) {}

  async list(sellerId: string): Promise<SellerAddressView[]> {
    return this.prisma.client.address.findMany({
      where: {
        ownerType: AddressOwnerType.SELLER,
        ownerId: sellerId,
        deletedAt: null,
        type: { in: SELLER_OWNED_TYPES },
      },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
      select: VIEW_SELECT,
    });
  }

  async create(
    sellerId: string,
    input: CreateSellerAddressDto,
    ctx: ClientContext,
  ): Promise<SellerAddressView> {
    if (!SELLER_OWNED_TYPES.includes(input.type)) {
      throw new BadRequestException({
        code: 'INVALID_ADDRESS_TYPE',
        message: 'Sellers can only manage BD_ORIGIN, BD_OFFICE, or IN_RETURN addresses',
      });
    }

    const country = COUNTRY_BY_TYPE[input.type];
    this.validatePhoneForCountry(input.contactPhone, country);
    this.validatePostalForCountry(input.postalCode, country);

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Default-of-type service-layer logic. If this is the first address
      // of its type for this seller it becomes the default automatically.
      // If isDefault=true, unset isDefault on others of the same type.
      const existingOfType = await tx.address.findMany({
        where: {
          ownerType: AddressOwnerType.SELLER,
          ownerId: sellerId,
          type: input.type,
          deletedAt: null,
        },
        select: { id: true, isDefault: true },
      });
      const shouldBeDefault = input.isDefault === true || existingOfType.length === 0;
      if (shouldBeDefault && existingOfType.some((r) => r.isDefault)) {
        await tx.address.updateMany({
          where: { id: { in: existingOfType.filter((r) => r.isDefault).map((r) => r.id) } },
          data: { isDefault: false },
        });
      }

      const row = await tx.address.create({
        data: {
          ownerType: AddressOwnerType.SELLER,
          ownerId: sellerId,
          type: input.type,
          label: input.label ?? null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          stateProvince: input.stateProvince,
          postalCode: input.postalCode,
          countryCode: country,
          isDefault: shouldBeDefault,
        },
        select: VIEW_SELECT,
      });

      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.address.created',
          entityType: 'address',
          entityId: row.id,
          metadata: {
            type: input.type,
            countryCode: country,
            isDefault: shouldBeDefault,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );

      const step = ONBOARDING_STEP_FOR_TYPE[input.type];
      if (step) {
        await this.onboarding.markStepComplete(
          sellerId,
          step,
          OnboardingStepActor.SELLER,
          { addressId: row.id },
          tx,
        );
      }

      return row;
    });

    return result;
  }

  async update(
    sellerId: string,
    addressId: string,
    input: UpdateSellerAddressDto,
    ctx: ClientContext,
  ): Promise<SellerAddressView> {
    const existing = await this.findOwnedOrThrow(sellerId, addressId);

    if (input.contactPhone !== undefined) {
      this.validatePhoneForCountry(input.contactPhone, existing.countryCode);
    }
    if (input.postalCode !== undefined) {
      this.validatePostalForCountry(input.postalCode, existing.countryCode);
    }

    const data: Prisma.AddressUpdateInput = {};
    const changes: Record<string, string | boolean | null> = {};
    const wantsDefault = input.isDefault === true;

    const assign = <K extends keyof UpdateSellerAddressDto>(
      key: K,
      modelKey: keyof Prisma.AddressUpdateInput,
    ): void => {
      const value = input[key];
      if (value === undefined) return;
      (data as Record<string, unknown>)[modelKey as string] = value;
      changes[modelKey as string] = value as string | boolean | null;
    };
    assign('label', 'label');
    assign('contactName', 'contactName');
    assign('contactPhone', 'contactPhone');
    assign('contactEmail', 'contactEmail');
    assign('line1', 'line1');
    assign('line2', 'line2');
    assign('landmark', 'landmark');
    assign('city', 'city');
    assign('stateProvince', 'stateProvince');
    assign('postalCode', 'postalCode');

    if (input.isDefault !== undefined) {
      changes['isDefault'] = input.isDefault;
    }

    return this.prisma.client.$transaction(async (tx) => {
      if (wantsDefault) {
        await tx.address.updateMany({
          where: {
            ownerType: AddressOwnerType.SELLER,
            ownerId: sellerId,
            type: existing.type,
            deletedAt: null,
            isDefault: true,
            id: { not: addressId },
          },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (input.isDefault === false) {
        data.isDefault = false;
      }

      const row = await tx.address.update({
        where: { id: addressId },
        data,
        select: VIEW_SELECT,
      });

      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.address.updated',
          entityType: 'address',
          entityId: row.id,
          changes: changes as Prisma.InputJsonValue,
          metadata: {
            type: row.type,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );

      return row;
    });
  }

  async softDelete(sellerId: string, addressId: string, ctx: ClientContext): Promise<void> {
    const existing = await this.findOwnedOrThrow(sellerId, addressId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isDefault: false },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.address.deleted',
          entityType: 'address',
          entityId: addressId,
          metadata: {
            type: existing.type,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
  }

  async setDefault(
    sellerId: string,
    addressId: string,
    ctx: ClientContext,
  ): Promise<SellerAddressView> {
    const existing = await this.findOwnedOrThrow(sellerId, addressId);

    return this.prisma.client.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: {
          ownerType: AddressOwnerType.SELLER,
          ownerId: sellerId,
          type: existing.type,
          deletedAt: null,
          isDefault: true,
          id: { not: addressId },
        },
        data: { isDefault: false },
      });
      const row = await tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.address.set_default',
          entityType: 'address',
          entityId: addressId,
          metadata: {
            type: row.type,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
  }

  // ---------- internal ----------

  private async findOwnedOrThrow(
    sellerId: string,
    addressId: string,
  ): Promise<{ id: string; type: AddressType; countryCode: string }> {
    const row = await this.prisma.client.address.findFirst({
      where: {
        id: addressId,
        ownerType: AddressOwnerType.SELLER,
        ownerId: sellerId,
        deletedAt: null,
      },
      select: { id: true, type: true, countryCode: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: 'Address not found' });
    }
    if (!SELLER_OWNED_TYPES.includes(row.type)) {
      // Defensive: shouldn't happen since sellers can only create the
      // three allowed types, but if some other code path attached an
      // IN_WAREHOUSE/RECIPIENT to a seller, refuse to manage it here.
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: 'Address not found' });
    }
    return row;
  }

  private validatePhoneForCountry(phone: string, country: string): void {
    if (country === 'BD' && !E164_BD.test(phone)) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'contactPhone must be E.164 BD format (e.g., +8801712345678)',
      });
    }
    if (country === 'IN' && !E164_IN.test(phone)) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'contactPhone must be E.164 IN format (e.g., +919876543210)',
      });
    }
  }

  private validatePostalForCountry(postal: string, country: string): void {
    if (country === 'BD' && !POSTAL_BD.test(postal)) {
      throw new BadRequestException({
        code: 'INVALID_POSTAL_CODE',
        message: 'postalCode must be 4 digits for BD',
      });
    }
    if (country === 'IN' && !POSTAL_IN.test(postal)) {
      throw new BadRequestException({
        code: 'INVALID_POSTAL_CODE',
        message: 'postalCode must be 6 digits for IN',
      });
    }
  }
}
