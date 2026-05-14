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
      findUnique: jest.fn(async ({ where }: { where: { code_language: { code: string; language: string } } }) => {
        return (
          rows.find(
            (r) => r.code === where.code_language.code && r.language === where.code_language.language,
          ) ?? null
        );
      }),
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
});
