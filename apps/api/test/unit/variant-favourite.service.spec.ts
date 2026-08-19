import { CatalogVariantService } from '../../src/modules/catalog-variant/services/catalog-variant.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Any = Record<string, unknown>;

/**
 * Starring a variant. Per SELLER, idempotent, and it must not be possible
 * to star somebody else's catalogue.
 */
function makeSut(opts: { variantExists?: boolean } = {}) {
  const upserts: Any[] = [];
  const deletes: Any[] = [];
  const client: Any = {
    productVariant: {
      findFirst: async () => (opts.variantExists === false ? null : { id: 'v1' }),
    },
    sellerFavouriteVariant: {
      upsert: async (a: Any) => {
        upserts.push(a);
        return { id: 'f1' };
      },
      deleteMany: async (a: Any) => {
        deletes.push(a);
        return { count: 1 };
      },
      findMany: async () => [],
    },
  };
  const svc = new CatalogVariantService(
    { client } as unknown as PrismaService,
    {} as never,
    {} as never,
  );
  return { svc, upserts, deletes };
}

describe('CatalogVariantService.setFavourite', () => {
  it('stars via UPSERT, so a double tap cannot make two rows', async () => {
    const sut = makeSut();
    await expect(sut.svc.setFavourite('s1', 'v1', true)).resolves.toEqual({ isFavourite: true });
    await sut.svc.setFavourite('s1', 'v1', true);
    expect(sut.upserts).toHaveLength(2);
    // Same unique key both times — the second is a no-op update, not a
    // second favourite that would need unstarring twice.
    expect(sut.upserts[0]?.['where']).toEqual({
      sellerId_variantId: { sellerId: 's1', variantId: 'v1' },
    });
    expect(sut.upserts[1]?.['where']).toEqual(sut.upserts[0]?.['where']);
  });

  it('unstars by deleting, scoped to this seller', async () => {
    const sut = makeSut();
    await expect(sut.svc.setFavourite('s1', 'v1', false)).resolves.toEqual({ isFavourite: false });
    expect(sut.deletes[0]?.['where']).toEqual({ sellerId: 's1', variantId: 'v1' });
  });

  it("refuses a variant that is not this seller's", async () => {
    // The lookup is scoped by sellerId, so somebody else's variant reads
    // as missing — a 404 rather than a 403, which is also the right
    // answer: they should not learn it exists.
    const sut = makeSut({ variantExists: false });
    await expect(sut.svc.setFavourite('s1', 'v-other', true)).rejects.toMatchObject({
      response: { code: 'VARIANT_NOT_FOUND' },
    });
    expect(sut.upserts).toHaveLength(0);
  });
});
