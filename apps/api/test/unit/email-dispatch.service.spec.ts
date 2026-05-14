import { NotificationChannel, NotificationRecipientType, NotificationStatus } from '@skydrop/db';
import { EmailDispatchService } from '../../src/modules/email/services/email-dispatch.service';
import type { TemplateRenderService } from '../../src/modules/email/services/template-render.service';
import type {
  ResendService,
  SendEmailFailure,
  SendEmailInput,
  SendEmailResult,
} from '../../src/modules/email/services/resend.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface CapturedCreate {
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

function makeSut(opts: {
  resendResponse: SendEmailResult | SendEmailFailure;
  templateHasHtml?: boolean;
  /** Pass null to explicitly produce a template with no subject. Omit to use
   *  the default "Reset your password". */
  templateSubject?: string | null;
}) {
  const captured: CapturedCreate[] = [];
  let nextId = 0;

  const prisma = {
    client: {
      notificationLog: {
        create: jest.fn(async (args: CapturedCreate) => {
          nextId += 1;
          captured.push(args);
          return { id: `log-${nextId}` };
        }),
      },
    },
  } as unknown as PrismaService;

  const subject = 'templateSubject' in opts ? opts.templateSubject : 'Reset your password';

  const render = {
    render: jest.fn(async (code: string) => ({
      templateId: 'tpl-1',
      templateCode: code,
      templateVersion: 7,
      subject,
      body: 'Hi Alex, click https://example.com to reset.',
      htmlBody: opts.templateHasHtml ? '<p>Hi Alex</p>' : null,
    })),
  } as unknown as TemplateRenderService;

  const resendSendMock: jest.Mock<Promise<SendEmailResult | SendEmailFailure>, [SendEmailInput]> =
    jest.fn(async (_input: SendEmailInput) => opts.resendResponse);
  const resend = { send: resendSendMock } as unknown as ResendService;

  return {
    svc: new EmailDispatchService(prisma, render, resend),
    captured,
    resendSendMock,
    renderMock: render.render as jest.Mock,
  };
}

describe('EmailDispatchService', () => {
  it('happy path: renders, sends, writes a SENT notification_log row', async () => {
    const { svc, captured, resendSendMock } = makeSut({
      resendResponse: { ok: true, providerMessageId: 'msg-abc' },
      templateHasHtml: true,
    });

    const result = await svc.send({
      templateCode: 'staff.password_reset.email',
      recipient: { type: NotificationRecipientType.STAFF, id: 'staff-1', email: 'alex@x.io' },
      variables: { name: 'Alex' },
      triggerEvent: 'password_reset_requested',
    });

    expect(result.status).toBe('SENT');
    expect(result.notificationLogId).toBe('log-1');
    expect(result.providerMessageId).toBe('msg-abc');

    // Resend was called with the security@ sender and the rendered body+html.
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const send = resendSendMock.mock.calls[0]![0] as unknown as Record<string, string>;
    expect(send['from']).toContain('security@skydrop.online');
    expect(send['replyTo']).toContain('support@skydrop.online');
    expect(send['to']).toBe('alex@x.io');
    expect(send['subject']).toBe('Reset your password');
    expect(send['text']).toContain('Hi Alex');
    expect(send['html']).toContain('<p>Hi Alex</p>');

    // notification_log row reflects SENT state.
    const logArgs = captured[0]!.data;
    expect(logArgs['status']).toBe(NotificationStatus.SENT);
    expect(logArgs['channel']).toBe(NotificationChannel.EMAIL);
    expect(logArgs['recipientType']).toBe(NotificationRecipientType.STAFF);
    expect(logArgs['recipientId']).toBe('staff-1');
    expect(logArgs['toEmail']).toBe('alex@x.io');
    expect(logArgs['templateId']).toBe('tpl-1');
    expect(logArgs['templateCode']).toBe('staff.password_reset.email');
    expect(logArgs['templateVersion']).toBe(7);
    expect(logArgs['provider']).toBe('resend');
    expect(logArgs['providerMessageId']).toBe('msg-abc');
    expect(logArgs['sentAt']).toBeInstanceOf(Date);
    expect(logArgs['failedAt']).toBeNull();
    expect(logArgs['triggerEvent']).toBe('password_reset_requested');
  });

  it('non-security templates resolve to hello@ sender', async () => {
    const { svc, resendSendMock } = makeSut({
      resendResponse: { ok: true, providerMessageId: 'msg-xyz' },
    });
    await svc.send({
      templateCode: 'seller.invitation.email',
      recipient: { type: NotificationRecipientType.SELLER, email: 'newseller@x.io' },
    });
    const send = resendSendMock.mock.calls[0]![0] as unknown as Record<string, string>;
    expect(send['from']).toContain('hello@skydrop.online');
  });

  it('failure path: returns FAILED + records failure code/message in log', async () => {
    const { svc, captured } = makeSut({
      resendResponse: { ok: false, code: 'RESEND_ERROR', message: 'rate limited' },
    });

    const result = await svc.send({
      templateCode: 'staff.password_reset.email',
      recipient: { type: NotificationRecipientType.STAFF, email: 'alex@x.io' },
    });

    expect(result.status).toBe('FAILED');
    expect(result.failureCode).toBe('RESEND_ERROR');
    expect(result.failureMessage).toBe('rate limited');
    expect(result.providerMessageId).toBeNull();

    const logArgs = captured[0]!.data;
    expect(logArgs['status']).toBe(NotificationStatus.FAILED);
    expect(logArgs['failureCode']).toBe('RESEND_ERROR');
    expect(logArgs['failureMessage']).toBe('rate limited');
    expect(logArgs['failedAt']).toBeInstanceOf(Date);
    expect(logArgs['sentAt']).toBeNull();
    expect(logArgs['providerMessageId']).toBeNull();
  });

  it('falls back to "(no subject)" when template has no subject', async () => {
    const { svc, resendSendMock } = makeSut({
      resendResponse: { ok: true, providerMessageId: 'm' },
      templateSubject: null,
    });
    await svc.send({
      templateCode: 'order.confirmed.customer.sms',
      recipient: { type: NotificationRecipientType.CUSTOMER, email: 'c@x.io' },
    });
    const send = resendSendMock.mock.calls[0]![0] as unknown as Record<string, string>;
    expect(send['subject']).toBe('(no subject)');
  });

  it('passes language through to the renderer', async () => {
    const { svc, renderMock } = makeSut({
      resendResponse: { ok: true, providerMessageId: 'm' },
    });
    await svc.send({
      templateCode: 'shipment.dispatched.customer.sms',
      language: 'hi',
      recipient: { type: NotificationRecipientType.CUSTOMER, email: 'c@x.io' },
      variables: { order_number: 'SD-2026-12-000001' },
    });
    expect(renderMock).toHaveBeenCalledWith(
      'shipment.dispatched.customer.sms',
      { order_number: 'SD-2026-12-000001' },
      'hi',
    );
  });
});
