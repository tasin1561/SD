import { NotFoundException } from '@nestjs/common';
import { TemplateRenderService } from '../../src/modules/email/services/template-render.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface FakeTemplate {
  id: string;
  code: string;
  language: string;
  version: number;
  subject: string | null;
  bodyTemplate: string;
  htmlBodyTemplate: string | null;
  isActive: boolean;
  deletedAt: Date | null;
}

function makeSut(rows: FakeTemplate[]): TemplateRenderService {
  const client = {
    notificationTemplate: {
      findUnique: jest.fn(
        async ({ where }: { where: { code_language: { code: string; language: string } } }) => {
          return (
            rows.find(
              (r) =>
                r.code === where.code_language.code && r.language === where.code_language.language,
            ) ?? null
          );
        },
      ),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  return new TemplateRenderService(prisma);
}

describe('TemplateRenderService', () => {
  it('renders subject and body with nunjucks variables', async () => {
    const svc = makeSut([
      {
        id: 't1',
        code: 'staff.password_reset.email',
        language: 'en',
        version: 1,
        subject: 'Reset your {{ company_name }} password',
        bodyTemplate: 'Hi {{ name }}, click {{ url }} to reset.',
        htmlBodyTemplate: null,
        isActive: true,
        deletedAt: null,
      },
    ]);

    const r = await svc.render('staff.password_reset.email', {
      company_name: 'Skydrop',
      name: 'Alex',
      url: 'https://app.skydrop.online/reset?token=xyz',
    });

    expect(r.templateId).toBe('t1');
    expect(r.templateVersion).toBe(1);
    expect(r.subject).toBe('Reset your Skydrop password');
    expect(r.body).toBe('Hi Alex, click https://app.skydrop.online/reset?token=xyz to reset.');
    expect(r.htmlBody).toBeNull();
  });

  it('renders htmlBodyTemplate with autoescape when present', async () => {
    const svc = makeSut([
      {
        id: 't2',
        code: 'seller.welcome.email',
        language: 'en',
        version: 3,
        subject: 'Welcome',
        bodyTemplate: 'Welcome {{ name }}',
        htmlBodyTemplate: '<p>Welcome {{ name }}</p>',
        isActive: true,
        deletedAt: null,
      },
    ]);
    const r = await svc.render('seller.welcome.email', { name: '<script>x</script>' });
    expect(r.body).toContain('<script>x</script>'); // plaintext not escaped
    expect(r.htmlBody).toContain('&lt;script&gt;'); // html escaped
  });

  it('does not html-escape ampersands in plaintext URLs', async () => {
    const svc = makeSut([
      {
        id: 't3',
        code: 'x.password_reset.email',
        language: 'en',
        version: 1,
        subject: null,
        bodyTemplate: 'Visit {{ url }}',
        htmlBodyTemplate: null,
        isActive: true,
        deletedAt: null,
      },
    ]);
    const r = await svc.render('x.password_reset.email', { url: 'https://x.com/?a=1&b=2' });
    expect(r.body).toBe('Visit https://x.com/?a=1&b=2');
  });

  it('falls back from a missing language to "en"', async () => {
    const svc = makeSut([
      {
        id: 't4',
        code: 'shipment.dispatched.customer.sms',
        language: 'en',
        version: 1,
        subject: null,
        bodyTemplate: 'EN body',
        htmlBodyTemplate: null,
        isActive: true,
        deletedAt: null,
      },
    ]);
    const r = await svc.render('shipment.dispatched.customer.sms', {}, 'hi');
    expect(r.body).toBe('EN body');
    expect(r.templateCode).toBe('shipment.dispatched.customer.sms');
  });

  it('throws NotFoundException when neither requested language nor en exist', async () => {
    const svc = makeSut([]);
    await expect(svc.render('does.not.exist', {})).rejects.toThrow(NotFoundException);
  });

  it('treats soft-deleted templates as missing', async () => {
    const svc = makeSut([
      {
        id: 't5',
        code: 'foo.bar.email',
        language: 'en',
        version: 1,
        subject: 'Hi',
        bodyTemplate: 'x',
        htmlBodyTemplate: null,
        isActive: true,
        deletedAt: new Date(),
      },
    ]);
    await expect(svc.render('foo.bar.email', {})).rejects.toThrow(NotFoundException);
  });

  it('treats inactive templates as missing', async () => {
    const svc = makeSut([
      {
        id: 't6',
        code: 'foo.bar.email',
        language: 'en',
        version: 1,
        subject: 'Hi',
        bodyTemplate: 'x',
        htmlBodyTemplate: null,
        isActive: false,
        deletedAt: null,
      },
    ]);
    await expect(svc.render('foo.bar.email', {})).rejects.toThrow(NotFoundException);
  });

  it('renderInline supports test cases without DB', () => {
    const svc = makeSut([]);
    expect(svc.renderInline('Hi {{ n }}', { n: 'Alex' })).toBe('Hi Alex');
    expect(svc.renderInline('<p>{{ n }}</p>', { n: '<x>' }, { html: true })).toContain('&lt;x&gt;');
  });

  // ── M11 — bilingual customer templates + tracking URL substitution ─
  describe('M11 customer.order_dispatched.email (priority template)', () => {
    // Mirrors the seeded row in packages/db/prisma/seed.ts. Pinning
    // the body here ensures the template-side wiring of the
    // {{ tracking_url }} variable (the M10 commit-9 lookup URL) is
    // intact across schema changes.
    const SEEDED_BODY =
      'Hi {{ customer_name }}, your order {{ order_number }} from ' +
      '{{ seller_company_name }} has been dispatched via ' +
      '{{ courier_name }} (AWB {{ awb_number }}). Track its progress ' +
      'any time at {{ tracking_url }}. Expected delivery: ' +
      '{{ expected_delivery_at }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, {{ seller_company_name }} से आपका ' +
      'ऑर्डर {{ order_number }} {{ courier_name }} के माध्यम से ' +
      'शिप कर दिया गया है (AWB {{ awb_number }})। यहाँ ट्रैक करें: ' +
      '{{ tracking_url }}. अनुमानित डिलीवरी: ' +
      '{{ expected_delivery_at }}.';

    it('renders the M10 tracking URL in the customer body (both languages)', async () => {
      const svc = makeSut([
        {
          id: 'tpl-dispatch',
          code: 'customer.order_dispatched.email',
          language: 'en',
          version: 2,
          subject:
            'Your order {{ order_number }} has shipped (AWB {{ awb_number }}) / आपका ऑर्डर {{ order_number }} शिप हो गया',
          bodyTemplate: SEEDED_BODY,
          htmlBodyTemplate: null,
          isActive: true,
          deletedAt: null,
        },
      ]);
      const r = await svc.render('customer.order_dispatched.email', {
        customer_name: 'Pooja',
        order_number: 'SD-2026-05-000042',
        seller_company_name: 'Acme Co',
        courier_name: 'Delhivery',
        awb_number: 'DLV99999',
        tracking_url: 'http://localhost:3003/track/DLV99999',
        expected_delivery_at: '2026-05-30',
      });

      // English half — substituted, tracking URL present.
      expect(r.body).toContain('Hi Pooja, your order SD-2026-05-000042');
      expect(r.body).toContain('from Acme Co');
      expect(r.body).toContain('via Delhivery (AWB DLV99999)');
      expect(r.body).toContain('http://localhost:3003/track/DLV99999');
      expect(r.body).toContain('Expected delivery: 2026-05-30');

      // Hindi half — substituted, tracking URL present.
      expect(r.body).toContain('नमस्ते Pooja');
      expect(r.body).toContain('Acme Co से आपका ऑर्डर SD-2026-05-000042');
      expect(r.body).toContain('Delhivery के माध्यम से');
      expect(r.body).toContain('यहाँ ट्रैक करें: http://localhost:3003/track/DLV99999');
      expect(r.body).toContain('अनुमानित डिलीवरी: 2026-05-30');

      // The "---" delimiter (between EN and HI halves) is preserved.
      expect(r.body).toMatch(/\n\n---\n\n/);

      // Subject also bilingual + AWB-substituted.
      expect(r.subject).toContain('SD-2026-05-000042 has shipped (AWB DLV99999)');
      expect(r.subject).toContain('SD-2026-05-000042 शिप हो गया');
    });

    it('ampersand in tracking URL is NOT escaped (plaintext body)', async () => {
      // The customer body is plaintext (htmlBodyTemplate is null); Nunjucks
      // textEnv has autoescape=false so a URL with query params survives
      // intact.
      const svc = makeSut([
        {
          id: 'tpl-dispatch',
          code: 'customer.order_dispatched.email',
          language: 'en',
          version: 1,
          subject: 'x',
          bodyTemplate: 'Track at {{ tracking_url }}',
          htmlBodyTemplate: null,
          isActive: true,
          deletedAt: null,
        },
      ]);
      const r = await svc.render('customer.order_dispatched.email', {
        tracking_url: 'https://track.skydrop.online/DLV1?a=1&b=2',
      });
      expect(r.body).toBe('Track at https://track.skydrop.online/DLV1?a=1&b=2');
    });
  });
});
