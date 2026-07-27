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
  /** Make the notification_logs write throw, to exercise the
   *  already-sent-but-unrecorded path. */
  ledgerWriteFails?: boolean;
}) {
  const captured: CapturedCreate[] = [];
  let nextId = 0;

  const capturedUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const prisma = {
    client: {
      notificationLog: {
        create: jest.fn(async (args: CapturedCreate) => {
          if (opts.ledgerWriteFails) throw new Error('connection terminated unexpectedly');
          nextId += 1;
          captured.push(args);
          return { id: `log-${nextId}` };
        }),
        update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          if (opts.ledgerWriteFails) throw new Error('No record was found for an update');
          capturedUpdates.push(args);
          return { id: args.where.id };
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

  const resendSendMock: jest.Mock<
    Promise<SendEmailResult | SendEmailFailure>,
    [SendEmailInput]
  > = jest.fn(async (_input: SendEmailInput) => opts.resendResponse);
  const resend = { send: resendSendMock } as unknown as ResendService;

  return {
    svc: new EmailDispatchService(prisma, render, resend),
    captured,
    capturedUpdates,
    prisma,
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

  // ── M11 (NOTIF-2 store-then-send) ─────────────────────────────────
  describe('existingNotificationLogId — M11 store-then-send UPDATE path', () => {
    it('UPDATEs the pre-created row instead of CREATing a fresh one on SENT', async () => {
      const { svc, captured, capturedUpdates, prisma } = makeSut({
        resendResponse: { ok: true, providerMessageId: 'msg-existing' },
        templateHasHtml: true,
      });

      const res = await svc.send({
        templateCode: 'seller.order_dispatched.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: 'seller-1',
          email: 'seller@x.io',
        },
        variables: { order_number: 'SD-X-1' },
        existingNotificationLogId: 'preflight-log-1',
      });

      expect(res.status).toBe('SENT');
      // No CREATE — the ledger already inserted the PENDING row.
      expect((prisma.client.notificationLog.create as jest.Mock).mock.calls).toHaveLength(0);
      expect(captured).toHaveLength(0);
      // ONE update to the pre-created row id.
      expect(capturedUpdates).toHaveLength(1);
      expect(capturedUpdates[0]?.where.id).toBe('preflight-log-1');
      expect(capturedUpdates[0]?.data['status']).toBe(NotificationStatus.SENT);
      expect(capturedUpdates[0]?.data['providerMessageId']).toBe('msg-existing');
      expect(capturedUpdates[0]?.data['sentAt']).toBeInstanceOf(Date);
      expect(res.notificationLogId).toBe('preflight-log-1');
    });

    it('UPDATEs the pre-created row to FAILED on send failure', async () => {
      const { svc, capturedUpdates } = makeSut({
        resendResponse: { ok: false, code: 'RESEND_ERROR', message: 'down' },
      });
      const res = await svc.send({
        templateCode: 'seller.order_dispatched.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: 'seller-1',
          email: 'seller@x.io',
        },
        existingNotificationLogId: 'preflight-log-2',
      });
      expect(res.status).toBe('FAILED');
      expect(capturedUpdates).toHaveLength(1);
      expect(capturedUpdates[0]?.where.id).toBe('preflight-log-2');
      expect(capturedUpdates[0]?.data['status']).toBe(NotificationStatus.FAILED);
      expect(capturedUpdates[0]?.data['failureCode']).toBe('RESEND_ERROR');
      expect(capturedUpdates[0]?.data['failedAt']).toBeInstanceOf(Date);
      expect(capturedUpdates[0]?.data['sentAt']).toBeNull();
    });

    it('legacy call path (no existingNotificationLogId) still CREATEs', async () => {
      const { svc, captured, capturedUpdates } = makeSut({
        resendResponse: { ok: true, providerMessageId: 'msg' },
      });
      await svc.send({
        templateCode: 'staff.password_reset.email',
        recipient: { type: NotificationRecipientType.STAFF, email: 'alex@x.io' },
      });
      // Legacy fire-once path unchanged: CREATE one row, no UPDATE.
      expect(captured).toHaveLength(1);
      expect(capturedUpdates).toHaveLength(0);
    });
  });

  /**
   * The send is irreversible; the ledger row is a reflection of it. Letting a
   * ledger failure propagate marks the BullMQ job failed, and the retry
   * re-enters send() and calls the provider AGAIN — up to five copies of
   * "your order has been dispatched" in a real inbox, caused by a database
   * hiccup unrelated to the email.
   */
  describe('a ledger failure must never cause a re-send', () => {
    it('reports SENT when the row write fails AFTER the provider accepted', async () => {
      const { svc } = makeSut({
        resendResponse: { ok: true, providerMessageId: 'msg-sent-for-real' },
        ledgerWriteFails: true,
      });

      const result = await svc.send({
        templateCode: 'customer.order_dispatched.email',
        recipient: { type: NotificationRecipientType.CUSTOMER, email: 'buyer@x.io' },
      });

      // SENT, not a throw — a throw is what triggers the duplicate.
      expect(result.status).toBe('SENT');
      // No row, and the result says so honestly rather than inventing an id.
      expect(result.notificationLogId).toBeNull();
      // The provider id is the only surviving record of the send.
      expect(result.providerMessageId).toBe('msg-sent-for-real');
    });

    it('does the same on the M11 update path', async () => {
      const { svc } = makeSut({
        resendResponse: { ok: true, providerMessageId: 'msg-2' },
        ledgerWriteFails: true,
      });
      const result = await svc.send({
        templateCode: 'customer.order_dispatched.email',
        recipient: { type: NotificationRecipientType.CUSTOMER, email: 'buyer@x.io' },
        existingNotificationLogId: 'pre-created-row',
      });
      expect(result.status).toBe('SENT');
      expect(result.notificationLogId).toBeNull();
    });

    it('STILL throws when the send failed too — nothing left the building, so retry', async () => {
      // The inverse case matters as much: if no email went out, a retry is
      // correct and swallowing the error would lose the message entirely.
      const { svc } = makeSut({
        resendResponse: { ok: false, code: 'RESEND_ERROR', message: 'rate limited' },
        ledgerWriteFails: true,
      });

      await expect(
        svc.send({
          templateCode: 'customer.order_dispatched.email',
          recipient: { type: NotificationRecipientType.CUSTOMER, email: 'buyer@x.io' },
        }),
      ).rejects.toThrow();
    });
  });
});
