import request from 'supertest';
import { BulkUploadStatus } from '@skydrop/db';
import { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Cross-feature catalog smoke (e2e): seller creates a product → a
 * variant carrying free-form attributes → image presign/register (mock
 * Spaces) → CSV import end-to-end with a saved mapping.
 *
 * This used to open with an admin building a category tree, because a
 * variant's attributes were validated against its category's inherited
 * definitions. Categories are gone: the inheritance chain is now
 * variant → product, gstRate falls through to `pricing.gst_rate`, and
 * the attribute map is free-form.
 */
describe('Catalog flow (e2e)', () => {
  let h: AppHarness;
  let staffAccess: string;
  let sellerAccess: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma);
    const staffLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAccess = staffLogin.body.accessToken as string;

    const email = `cat-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Catalog Brand',
        contactPersonName: 'Cat Owner',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);
    expect(reg.body.seller.status).toBe('APPROVED');
    sellerAccess = reg.body.accessToken as string;
  });

  it('product → variant → image → CSV import', async () => {
    const sellerAuth = { Authorization: `Bearer ${sellerAccess}` };

    // 1) Seller creates a product. There is no category to file it under
    //    — the chain is variant → product, and gstRate falls through to
    //    the `pricing.gst_rate` system setting.
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Premium Tee', externalRef: 'PT-1' })
      .expect(201);
    const productId = product.body.id as string;

    // 2) A variant carrying free-form attributes.
    //
    //    This is the case that used to FAIL. Attribute definitions were
    //    category-scoped, so a product with no category had an empty
    //    effective set and the validator rejected every key as unknown —
    //    meaning attributes were unusable unless an admin had first
    //    built a category for them. Removing categories makes the map
    //    what a seller always assumed it was.
    const okVariant = await request(h.baseUrl)
      .post(`/seller/products/${productId}/variants`)
      .set(sellerAuth)
      .send({
        skuCode: 'PT-1-RED',
        attributes: { color: 'Red', material: 'Cotton' },
      })
      .expect(201);
    const variantId = okVariant.body.id as string;
    expect(okVariant.body.attributes).toEqual({ color: 'Red', material: 'Cotton' });

    // 7) Image presign → simulate client upload → register (HEAD-verified).
    const spaces = h.app.get(SpacesService);
    const presign = await request(h.baseUrl)
      .post(`/seller/variants/${variantId}/images/presign`)
      .set(sellerAuth)
      .send({ mimeType: 'image/png' })
      .expect(200);
    const imgBody = Buffer.from('fake-png-bytes-for-e2e');
    await spaces.putObject(presign.body.spacesKey, imgBody, 'image/png');
    const registered = await request(h.baseUrl)
      .post(`/seller/variants/${variantId}/images`)
      .set(sellerAuth)
      .send({
        spacesKey: presign.body.spacesKey,
        mimeType: 'image/png',
        sizeBytes: imgBody.byteLength,
        isPrimary: true,
      })
      .expect(201);
    expect(registered.body.isPrimary).toBe(true);

    // 8) Saved CSV mapping + CSV import end-to-end.
    const mapping = await request(h.baseUrl)
      .post('/seller/csv-mappings')
      .set(sellerAuth)
      .send({
        name: 'Standard export',
        columnMap: { productName: 'Product Name', variantSkuCode: 'SKU' },
        isDefault: true,
      })
      .expect(201);

    const csvPresign = await request(h.baseUrl)
      .post('/seller/csv-imports/presign')
      .set(sellerAuth)
      .send({ fileName: 'catalog.csv' })
      .expect(200);
    const csv = 'Product Name,Product ID,SKU\nBulk Tee,BT-1,BT-1-S\nBulk Tee,BT-1,BT-1-M\n';
    await spaces.putObject(csvPresign.body.spacesKey, Buffer.from(csv, 'utf8'), 'text/csv');

    const preview = await request(h.baseUrl)
      .post('/seller/csv-imports/preview')
      .set(sellerAuth)
      .send({ spacesKey: csvPresign.body.spacesKey, mappingId: mapping.body.id })
      .expect(200);
    expect(preview.body.mapping.productName).toBe('Product Name');
    expect(preview.body.missingRequired).toEqual([]);

    const process = await request(h.baseUrl)
      .post('/seller/csv-imports/process')
      .set(sellerAuth)
      .send({
        spacesKey: csvPresign.body.spacesKey,
        fileName: 'catalog.csv',
        mappingId: mapping.body.id,
      })
      .expect(202);
    const uploadId = process.body.id as string;

    const finished = await waitFor(
      async () => {
        const row = await h.prisma.bulkProductUpload.findUnique({
          where: { id: uploadId },
        });
        return row &&
          row.status !== BulkUploadStatus.PENDING &&
          row.status !== BulkUploadStatus.PROCESSING
          ? row
          : null;
      },
      { description: 'bulk upload terminal status', timeoutMs: 15000 },
    );
    expect(finished.status).toBe(BulkUploadStatus.COMPLETED);
    expect(finished.productsCreated).toBe(1);
    expect(finished.variantsCreated).toBe(2);
    expect(finished.mappingId).toBe(mapping.body.id);

    // Saved mapping's lastUsedAt was bumped by the import.
    const savedMapping = await h.prisma.sellerCsvMapping.findUnique({
      where: { id: mapping.body.id },
    });
    expect(savedMapping!.lastUsedAt).toBeInstanceOf(Date);

    // The imported product/variants are now queryable by the seller.
    const products = await request(h.baseUrl)
      .get('/seller/products?search=Bulk')
      .set(sellerAuth)
      .expect(200);
    expect(products.body.total).toBe(1);
  });
});
