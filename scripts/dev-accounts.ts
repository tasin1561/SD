import argon2 from 'argon2';
import { prisma, StaffRole } from '@skydrop/db';

const API = 'http://127.0.0.1:4000';
const STAFF = { email: 'admin@test.local', password: 'Test-Admin-1234' };
const SELLER = { email: 'seller@test.local', password: 'Test-Seller-1234' };

type Json = Record<string, unknown>;
async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${t.slice(0, 300)}`);
  return t ? (JSON.parse(t) as Json) : {};
}

async function main(): Promise<void> {
  const existing = await prisma.staffUser.findUnique({ where: { email: STAFF.email } });
  if (!existing) {
    await prisma.staffUser.create({
      data: {
        email: STAFF.email,
        emailDisplay: STAFF.email,
        passwordHash: await argon2.hash(STAFF.password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        role: StaffRole.SUPER_ADMIN,
      },
    });
  }
  const login = await call('/auth/staff/login', { method: 'POST', body: STAFF });
  const staffToken = login['accessToken'] as string;

  let sellerToken: string;
  const seller = await prisma.seller.findUnique({ where: { email: SELLER.email } });
  if (!seller) {
    const invite = await call('/admin/seller-invitations', {
      method: 'POST',
      token: staffToken,
      body: { email: SELLER.email },
    });
    const reg = await call('/auth/seller/register/invite', {
      method: 'POST',
      body: {
        token: invite['token'],
        companyName: 'Test Brand',
        contactPersonName: 'Test Owner',
        phone: '+8801700000001',
        password: SELLER.password,
      },
    });
    sellerToken = reg['accessToken'] as string;
  } else {
    const l = await call('/auth/seller/login', { method: 'POST', body: SELLER });
    sellerToken = l['accessToken'] as string;
  }

  // Stock: three SKUs with plenty on hand, so you can place many orders.
  const whs = (await call('/admin/warehouses', { token: staffToken })) as unknown as Array<{
    id: string;
  }>;
  const wh = whs[0]!;
  const bins = (await call(`/admin/warehouses/${wh.id}/bins`, {
    token: staffToken,
  })) as unknown as Array<{ id: string; type: string }>;
  const binId = bins.find((b) => b.type === 'STORAGE' || b.type === 'FLOOR')!.id;

  for (const name of ['Blue T-Shirt', 'Phone Case', 'Water Bottle']) {
    const sku = name.replace(/\s+/g, '-').toUpperCase();
    const already = await prisma.productVariant.findFirst({ where: { skuCode: sku } });
    if (already) continue;
    const product = await call('/seller/products', {
      method: 'POST',
      token: sellerToken,
      body: { name, externalRef: sku },
    });
    const variant = await call(`/seller/products/${product['id']}/variants`, {
      method: 'POST',
      token: sellerToken,
      body: { skuCode: sku, weightGrams: 400, declaredValueInr: 600 },
    });
    const gr = await call('/seller/goods-receipts', {
      method: 'POST',
      token: sellerToken,
      body: { lines: [{ variantId: variant['id'], expectedQty: 50 }] },
    });
    const lines = gr['lines'] as Array<{ id: string }>;
    await call(`/admin/goods-receipts/${gr['id']}/start-receiving`, {
      method: 'POST',
      token: staffToken,
    });
    await call(`/admin/goods-receipts/${gr['id']}/lines`, {
      method: 'POST',
      token: staffToken,
      body: { lines: [{ lineId: lines[0]!.id, receivedQty: 50, putawayBinId: binId }] },
    });
    await call(`/admin/goods-receipts/${gr['id']}/complete`, { method: 'POST', token: staffToken });
    console.log(`  stocked ${name} (${sku}) × 50`);
  }
  console.log('\nADMIN   http://localhost:3002   ' + STAFF.email + ' / ' + STAFF.password);
  console.log('SELLER  http://localhost:3003   ' + SELLER.email + ' / ' + SELLER.password);
  console.log('TRACK   http://localhost:3004');
}
main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error((e as Error).message);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
