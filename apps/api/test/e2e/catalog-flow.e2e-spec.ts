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
 * Cross-feature catalog smoke (e2e): admin builds a category tree with
 * attributes → seller proposes a subcategory → admin approves (creating
 * the category + attribute defs in one tx) → seller creates a product →
 * a variant whose attributes are validated against the inherited
 * effective set (valid passes, invalid 400s) → image presign/register
 * (mock Spaces) → CSV import end-to-end with a saved mapping.
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

  it('admin tree + attributes → proposal → approval → product → variant validation → image → CSV', async () => {
    const staffAuth = { Authorization: `Bearer ${staffAccess}` };
    const sellerAuth = { Authorization: `Bearer ${sellerAccess}` };

    // 1) Admin creates a root category.
    const root = await request(h.baseUrl)
      .post('/admin/categories')
      .set(staffAuth)
      .send({ name: 'Apparel', slug: 'apparel' })
      .expect(201);
    expect(root.body.depth).toBe(0);
    expect(root.body.fullPath).toBe('Apparel');

    // 2) Admin defines inherited attributes on the root.
    await request(h.baseUrl)
      .post(`/admin/categories/${root.body.id}/attributes`)
      .set(staffAuth)
      .send({
        attributeKey: 'color',
        displayLabel: 'Colour',
        valueType: 'ENUM',
        allowedValues: ['Red', 'Blue'],
        isRequired: true,
      })
      .expect(201);

    // 3) Seller proposes a subcategory under the root.
    const proposal = await request(h.baseUrl)
      .post('/seller/category-proposals')
      .set(sellerAuth)
      .send({
        proposedName: 'Premium Apparel',
        proposedSlug: 'premium-apparel',
        proposedParentId: root.body.id,
        rationale: 'We sell a distinct premium apparel line and need its own node.',
      })
      .expect(201);

    // 4) Admin approves — creates the category + an extra attribute def.
    const approval = await request(h.baseUrl)
      .post(`/admin/category-proposals/${proposal.body.id}/approve`)
      .set(staffAuth)
      .send({
        decisionNote: 'Approved.',
        attributeDefinitions: [
          {
            attributeKey: 'material',
            displayLabel: 'Material',
            valueType: 'STRING',
            isRequired: true,
          },
        ],
      })
      .expect(200);
    const categoryId = approval.body.categoryId as string;
    expect(categoryId).toBeTruthy();
    expect(approval.body.attributeDefinitionsCreated).toBe(1);

    // Effective attributes for the child = inherited `color` + own `material`.
    const eff = await request(h.baseUrl)
      .get(`/admin/categories/${categoryId}/attributes/effective`)
      .set(staffAuth)
      .expect(200);
    const keys = (eff.body as Array<{ attributeKey: string }>).map((a) => a.attributeKey).sort();
    expect(keys).toEqual(['color', 'material']);

    // 5) Seller creates a product in the approved category.
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Premium Tee', categoryId, externalRef: 'PT-1' })
      .expect(201);
    const productId = product.body.id as string;

    // 6) Valid variant — satisfies required color (enum) + material.
    const okVariant = await request(h.baseUrl)
      .post(`/seller/products/${productId}/variants`)
      .set(sellerAuth)
      .send({
        skuCode: 'PT-1-RED',
        attributes: { color: 'Red', material: 'Cotton' },
      })
      .expect(201);
    const variantId = okVariant.body.id as string;

    // 6b) Invalid variant — bad enum value + missing required material.
    const badVariant = await request(h.baseUrl)
      .post(`/seller/products/${productId}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'PT-1-GREEN', attributes: { color: 'Green' } })
      .expect(400);
    expect(badVariant.body.code).toBe('ATTRIBUTE_VALIDATION_FAILED');

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
