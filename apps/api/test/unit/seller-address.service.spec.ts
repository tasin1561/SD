import { BadRequestException } from '@nestjs/common';
import { AddressOwnerType, AddressType, SellerOnboardingStep } from '@skydrop/db';
import { SellerAddressService } from '../../src/modules/seller-address/services/seller-address.service';
import type { SellerOnboardingService } from '../../src/modules/seller-onboarding/services/seller-onboarding.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

interface AddrRow {
  id: string;
  ownerId: string;
  ownerType: AddressOwnerType;
  type: AddressType;
  isDefault: boolean;
  countryCode: string;
  deletedAt: Date | null;
  contactPhone: string;
  postalCode: string;
}

function makeSut() {
  const rows: AddrRow[] = [];
  let nextId = 1;
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const markStepComplete = jest
    .fn()
    .mockResolvedValue({ marked: true, onboardingCompleted: false });

  const txClient = {
    address: {
      findMany: jest.fn(
        async (args: { where: { type: AddressType; ownerId: string; deletedAt: null } }) => {
          return rows.filter(
            (r) =>
              r.ownerType === AddressOwnerType.SELLER &&
              r.ownerId === args.where.ownerId &&
              r.type === args.where.type &&
              r.deletedAt === null,
          );
        },
      ),
      updateMany: jest.fn(
        async (args: { where: { id?: { in: string[] } }; data: Partial<AddrRow> }) => {
          if (args.where.id?.in) {
            let count = 0;
            for (const r of rows) {
              if (args.where.id.in.includes(r.id)) {
                Object.assign(r, args.data);
                count++;
              }
            }
            return { count };
          }
          return { count: 0 };
        },
      ),
      create: jest.fn(async (args: { data: Omit<AddrRow, 'id' | 'deletedAt'> }) => {
        const row: AddrRow = {
          id: `addr-${nextId++}`,
          deletedAt: null,
          ...args.data,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<AddrRow> }) => {
        const r = rows.find((x) => x.id === args.where.id);
        if (r) Object.assign(r, args.data);
        return r;
      }),
    },
    auditLog: { create: auditCreate },
  };

  const prismaClient = {
    address: {
      findFirst: jest.fn(async (args: { where: { id: string } }) => {
        return rows.find((r) => r.id === args.where.id && r.deletedAt === null) ?? null;
      }),
      findMany: jest.fn(async () => rows.filter((r) => r.deletedAt === null)),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txClient) => unknown) => cb(txClient)),
  };

  const prisma = { client: prismaClient } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const onboarding = { markStepComplete } as unknown as SellerOnboardingService;
  const svc = new SellerAddressService(prisma, audit, onboarding);
  return { svc, rows, markStepComplete, auditCreate, prismaClient, txClient };
}

const VALID_BD_ADDR = {
  type: AddressType.BD_ORIGIN,
  contactName: 'Sara K',
  contactPhone: '+8801712345678',
  line1: '12 Main Rd',
  city: 'Dhaka',
  stateProvince: 'Dhaka',
  postalCode: '1212',
};

describe('SellerAddressService — create validation', () => {
  it('rejects non-seller-owned address types', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.create('seller-1', { ...VALID_BD_ADDR, type: AddressType.RECIPIENT } as never, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects BD address with IN phone format', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.create('seller-1', { ...VALID_BD_ADDR, contactPhone: '+919876543210' }, ctx),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PHONE' } });
  });

  it('rejects BD address with wrong-length postal', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.create('seller-1', { ...VALID_BD_ADDR, postalCode: '123456' }, ctx),
    ).rejects.toMatchObject({ response: { code: 'INVALID_POSTAL_CODE' } });
  });

  it('rejects IN_RETURN with BD phone', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.create(
        'seller-1',
        {
          ...VALID_BD_ADDR,
          type: AddressType.IN_RETURN,
          contactPhone: '+8801712345678',
          postalCode: '560001',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PHONE' } });
  });
});

describe('SellerAddressService — default logic + onboarding integration', () => {
  it('first-of-type becomes default automatically', async () => {
    const sut = makeSut();
    const created = await sut.svc.create('seller-1', VALID_BD_ADDR, ctx);
    expect(created.isDefault).toBe(true);
  });

  it('creating BD_ORIGIN marks the BD_ORIGIN_ADDRESS_ADDED step', async () => {
    const sut = makeSut();
    await sut.svc.create('seller-1', VALID_BD_ADDR, ctx);
    expect(sut.markStepComplete).toHaveBeenCalledWith(
      'seller-1',
      SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
      expect.anything(),
      expect.objectContaining({ addressId: expect.any(String) }),
      expect.anything(),
    );
  });

  it('isDefault=true on second-of-type unsets prior default', async () => {
    const sut = makeSut();
    const first = await sut.svc.create('seller-1', VALID_BD_ADDR, ctx);
    expect(first.isDefault).toBe(true);

    const second = await sut.svc.create(
      'seller-1',
      { ...VALID_BD_ADDR, line1: 'Other Addr', isDefault: true },
      ctx,
    );
    expect(second.isDefault).toBe(true);

    const firstRow = sut.rows.find((r) => r.id === first.id)!;
    expect(firstRow.isDefault).toBe(false);
  });

  it('isDefault omitted on second-of-type keeps existing default intact', async () => {
    const sut = makeSut();
    const first = await sut.svc.create('seller-1', VALID_BD_ADDR, ctx);
    const second = await sut.svc.create('seller-1', { ...VALID_BD_ADDR, line1: 'Office' }, ctx);
    expect(second.isDefault).toBe(false);
    const firstRow = sut.rows.find((r) => r.id === first.id)!;
    expect(firstRow.isDefault).toBe(true);
  });
});
