import { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import { displayImageKey } from '../../src/modules/catalog-image/image-key';

/**
 * The order line's picture.
 *
 * `order_items.imageUrl` is part of the ORD-6 snapshot and holds the
 * canonical object URL. Since the bucket went private (2026-07-28) that
 * URL resolves for nobody, so a line rendered from the snapshot shows a
 * broken image on every order. The read path replaces it with a
 * presigned thumbnail minted per request.
 *
 * These tests pin the two properties that make that correct: the
 * thumbnail key is preferred over the original (a 36px cell must not
 * serve a multi-megabyte photo), and the lookup is ONE query however
 * many lines the order has.
 */
describe('CatalogReadService.thumbnailUrlsByVariant', () => {
  const image = (
    over: Partial<{ variantId: string; spacesKey: string; thumbnailUrl: string | null }> = {},
  ) => ({
    variantId: 'v1',
    spacesKey: 'sellers/s1/variants/v1/tok.jpg',
    thumbnailUrl: 'https://stored/thumb.webp',
    ...over,
  });

  function make(images: ReturnType<typeof image>[]) {
    const findMany = jest.fn().mockResolvedValue(images);
    // The description lives on the PRODUCT (variants have none), so the
    // resolver reads both tables — one pair of queries for the whole
    // order, never one per line.
    const variantFindMany = jest
      .fn()
      .mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, product: { description: `about ${id}` } })),
      );
    const presignGetUrl = jest.fn((key: string) => Promise.resolve(`signed:${key}`));
    const svc = new CatalogReadService(
      {
        client: { productImage: { findMany }, productVariant: { findMany: variantFindMany } },
      } as never,
      { presignGetUrl } as never,
    );
    return { svc, findMany, variantFindMany, presignGetUrl };
  }

  it('presigns the THUMBNAIL key, never the original, when a thumbnail exists', async () => {
    const { svc, presignGetUrl } = make([image()]);
    const out = await svc.thumbnailUrlsByVariant(['v1']);
    expect(presignGetUrl).toHaveBeenCalledWith('sellers/s1/variants/v1/thumbnails/tok.webp');
    expect(out.get('v1')).toBe('signed:sellers/s1/variants/v1/thumbnails/tok.webp');
  });

  it('falls back to the original rather than dropping the picture', async () => {
    const { svc, presignGetUrl } = make([image({ thumbnailUrl: null })]);
    await svc.thumbnailUrlsByVariant(['v1']);
    expect(presignGetUrl).toHaveBeenCalledWith('sellers/s1/variants/v1/tok.jpg');
  });

  it('is ONE query for every line, not one per line', async () => {
    const { svc, findMany } = make([
      image({ variantId: 'v1' }),
      image({ variantId: 'v2', spacesKey: 'sellers/s1/variants/v2/tok.jpg' }),
    ]);
    const out = await svc.thumbnailUrlsByVariant(['v1', 'v2', 'v1']);
    expect(findMany).toHaveBeenCalledTimes(1);
    // Duplicates collapse before the query — a two-of-the-same-SKU order
    // must not ask twice.
    expect(findMany.mock.calls[0]?.[0].where.variantId.in).toEqual(['v1', 'v2']);
    expect(out.size).toBe(2);
  });

  it('returns the product description beside the picture', async () => {
    // An agent mid-call is asked "what is it, exactly?", and a SKU code
    // does not answer that.
    const { svc } = make([image()]);
    const info = await svc.displayInfoByVariant(['v1']);
    expect(info.get('v1')?.description).toBe('about v1');
    expect(info.get('v1')?.thumbnailUrl).toContain('thumbnails');
  });

  it('omits the URL for a variant with no image, so the caller renders a blank tile', async () => {
    const { svc } = make([]);
    expect((await svc.thumbnailUrlsByVariant(['v1'])).get('v1')).toBeUndefined();
    // The row still exists — a described product with no photograph is
    // normal, and dropping it would lose the description too.
    expect((await svc.displayInfoByVariant(['v1'])).get('v1')?.thumbnailUrl).toBeNull();
  });

  it('asks nothing at all for an empty order', async () => {
    const { svc, findMany } = make([]);
    expect((await svc.thumbnailUrlsByVariant([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('displayImageKey', () => {
  it('prefers the thumbnail and survives an unparseable key', () => {
    expect(displayImageKey({ spacesKey: 'sellers/s/variants/v/t.jpg', thumbnailUrl: 'x' })).toBe(
      'sellers/s/variants/v/thumbnails/t.webp',
    );
    expect(displayImageKey({ spacesKey: 'legacy/thing.jpg', thumbnailUrl: 'x' })).toBe(
      'legacy/thing.jpg',
    );
  });
});
