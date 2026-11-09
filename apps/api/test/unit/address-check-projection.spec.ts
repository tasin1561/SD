import { AddressCheckService } from '../../src/modules/address-check/services/address-check.service';
import type { SolustationHttpService } from '../../src/modules/address-check/services/solustation-http.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function serviceWith(row: Record<string, unknown> | null): AddressCheckService {
  const prisma = {
    client: { addressCheck: { findUnique: jest.fn(async () => row) } },
  } as unknown as PrismaService;
  return new AddressCheckService(prisma, {} as SolustationHttpService);
}

const base = { referenceId: 'draft-1', status: 'valid' };

describe('AddressCheckService.storedViewForOrder', () => {
  it('carries questions and providersUsed through verbatim', async () => {
    const questions = [
      { field: 'post_office', text: 'Which is your post office?', options: ['Raidighi', 'Damkal'] },
      { field: 'street', text: 'What is the street?' },
    ];
    const v = await serviceWith({
      ...base,
      result: {
        status: 'valid',
        recommended_action: 'approve',
        validity_score: 75,
        questions,
        providers_used: ['ola', 'database'],
      },
    }).storedViewForOrder('o1');
    expect(v?.questions).toEqual(questions);
    expect(v?.providersUsed).toEqual(['ola', 'database']);
    expect(v?.score).toBe(75);
  });

  it('defaults both to empty arrays when the judgement omits them', async () => {
    const v = await serviceWith({
      ...base,
      result: { status: 'valid', recommended_action: 'approve' },
    }).storedViewForOrder('o1');
    expect(v?.questions).toEqual([]);
    expect(v?.providersUsed).toEqual([]);
  });

  it('returns empties for an unavailable stored check', async () => {
    const v = await serviceWith({
      ...base,
      status: 'unavailable',
      result: null,
    }).storedViewForOrder('o1');
    expect(v?.available).toBe(false);
    expect(v?.questions).toEqual([]);
    expect(v?.providersUsed).toEqual([]);
  });

  it('returns null when the order has no check', async () => {
    expect(await serviceWith(null).storedViewForOrder('o1')).toBeNull();
  });
});
