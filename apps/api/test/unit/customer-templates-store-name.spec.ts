import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Environment } from 'nunjucks';

/**
 * RS-10 — customer emails name the business the customer BOUGHT FROM.
 *
 * The seeded customer templates read `{{ store_name }}`, which the
 * listener sets to a reseller store's name on its orders and to the
 * seller's company on every other order — so a channel order's email
 * reads exactly as it did. No customer template may reach for the
 * seller's company by name (`seller_company_name` / `company_name`):
 * that is the one way a reseller store's customer would learn who
 * really sold them the goods.
 *
 * The seed UPSERTS templates (bodyTemplate is in `update:`), so the
 * deploy's re-seed rewrites the live rows; no data migration is needed.
 */
const SEED = readFileSync(join(__dirname, '../../../../packages/db/prisma/seed.ts'), 'utf8');

/** Each `customer.*` template's code and body, read out of the seed. */
function customerTemplates(): Array<{ code: string; subject: string; body: string }> {
  const out: Array<{ code: string; subject: string; body: string }> = [];
  const re = /^\s{4}code: '(customer\.[^']+)',$/gm;
  for (const m of SEED.matchAll(re)) {
    const start = m.index ?? 0;
    const end = SEED.indexOf('\n  },', start);
    const block = SEED.slice(start, end);
    const literals = (s: string): string =>
      Array.from(s.matchAll(/'((?:[^'\\]|\\.)*)'/g), (x) =>
        (x[1] ?? '').replace(/\\n/g, '\n').replace(/\\'/g, "'"),
      ).join('');
    const subjectAt = block.indexOf('subject:');
    const bodyAt = block.indexOf('bodyTemplate:');
    out.push({
      code: m[1] ?? '',
      subject: subjectAt < 0 ? '' : literals(block.slice(subjectAt, bodyAt)),
      body: literals(block.slice(bodyAt + 'bodyTemplate:'.length)),
    });
  }
  return out;
}

const env = new Environment(null, { autoescape: false, throwOnUndefined: false });

describe('customer templates name the store (RS-10)', () => {
  const templates = customerTemplates();

  it('finds the bilingual customer lifecycle templates', () => {
    expect(templates.map((t) => t.code)).toEqual(
      expect.arrayContaining([
        'customer.order_confirmed.email',
        'customer.order_dispatched.email',
        'customer.order_delivered.email',
        'customer.order_cancelled.email',
      ]),
    );
  });

  it('no customer template names the seller company', () => {
    for (const t of templates) {
      expect(`${t.subject}${t.body}`).not.toMatch(/seller_company_name|\{\{\s*company_name\s*\}\}/);
    }
  });

  it('every template that names who sold it uses store_name', () => {
    const naming = templates.filter((t) => /store_name/.test(t.body));
    expect(naming.map((t) => t.code).sort()).toEqual(
      [
        'customer.order_cancelled.email',
        'customer.order_delivered.email',
        'customer.order_dispatched.email',
      ].sort(),
    );
  });

  it('a CHANNEL order renders with the seller company, never a blank', () => {
    const dispatched = templates.find((t) => t.code === 'customer.order_dispatched.email');
    const html = env.renderString(dispatched?.body ?? '', {
      customer_name: 'Pooja',
      order_number: 'SD-1',
      store_name: 'Acme Co',
      courier_name: 'Delhivery',
      awb_number: 'DLV1',
      tracking_url: 'https://track/DLV1',
    });
    expect(html).toContain('from Acme Co has been dispatched');
    expect(html).toContain('Acme Co से आपका ऑर्डर');
  });

  it('a RESELLER order renders with the store name, and the seller nowhere', () => {
    for (const t of templates) {
      const text = env.renderString(`${t.subject}\n${t.body}`, {
        customer_name: 'Pooja',
        order_number: 'SD-1',
        store_name: 'Kurta Corner',
        // What the listener hands a reseller order's customer target.
        company_name: 'Kurta Corner',
        seller_company_name: 'Kurta Corner',
      });
      expect(text).not.toContain('Acme');
      if (/store_name/.test(t.body)) expect(text).toContain('Kurta Corner');
    }
  });
});
