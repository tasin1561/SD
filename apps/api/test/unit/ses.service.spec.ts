import {
  SesService,
  buildSesPayload,
  classifySesFailure,
} from '../../src/modules/email/services/ses.service';
import { signRequest } from '../../src/modules/email/services/aws-sigv4';
import type { SendEmailInput } from '../../src/modules/email/email-provider';
import { makeTestEnv } from '../helpers/env';

const CONFIGURED = {
  AWS_SES_REGION: 'ap-south-1',
  AWS_SES_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  AWS_SES_SECRET_ACCESS_KEY: 'secret-example',
} as const;

const MESSAGE: SendEmailInput = {
  from: 'Skydrop <hello@skydrop.online>',
  to: 'customer@example.com',
  subject: 'Your order has shipped',
  text: 'Tracking: ABC123',
  replyTo: 'Skydrop Support <support@skydrop.online>',
};

describe('SesService', () => {
  describe('liveness — all three credentials or none', () => {
    it('is not live with nothing configured', () => {
      expect(new SesService(makeTestEnv()).isLive()).toBe(false);
    });

    it.each([
      ['region', { ...CONFIGURED, AWS_SES_REGION: '' }],
      ['access key', { ...CONFIGURED, AWS_SES_ACCESS_KEY_ID: '' }],
      ['secret', { ...CONFIGURED, AWS_SES_SECRET_ACCESS_KEY: '' }],
    ])('is not live with a missing %s', (_which, env) => {
      // A half-configured provider boots clean and 403s on the first
      // real message — the worst moment to learn a key was missing.
      expect(new SesService(makeTestEnv(env)).isLive()).toBe(false);
    });

    it('is live with all three', () => {
      expect(new SesService(makeTestEnv(CONFIGURED)).isLive()).toBe(true);
    });
  });

  describe('an unconfigured SES refuses rather than fabricating a success', () => {
    it('answers SES_NOT_CONFIGURED as a TRANSPORT failure', async () => {
      const result = await new SesService(makeTestEnv()).send(MESSAGE);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('SES_NOT_CONFIGURED');
      expect(result.kind).toBe('TRANSPORT');
    });
  });

  describe('the SESv2 payload', () => {
    it('carries the sender, recipient, reply-to and both bodies', () => {
      const payload = buildSesPayload({ ...MESSAGE, html: '<p>Tracking</p>' });
      expect(payload).toEqual({
        FromEmailAddress: 'Skydrop <hello@skydrop.online>',
        Destination: { ToAddresses: ['customer@example.com'] },
        ReplyToAddresses: ['Skydrop Support <support@skydrop.online>'],
        Content: {
          Simple: {
            Subject: { Data: 'Your order has shipped', Charset: 'UTF-8' },
            Body: {
              Text: { Data: 'Tracking: ABC123', Charset: 'UTF-8' },
              Html: { Data: '<p>Tracking</p>', Charset: 'UTF-8' },
            },
          },
        },
      });
    });

    it('omits Html entirely when there is no HTML body', () => {
      const payload = buildSesPayload(MESSAGE);
      const simple = (payload['Content'] as Record<string, Record<string, unknown>>)['Simple'];
      const body = simple?.['Body'] as Record<string, unknown>;
      expect(body).not.toHaveProperty('Html');
    });

    it('carries custom headers as SES MessageHeader entries', () => {
      // The only header we ever set is the staging redirect's, and it
      // has to survive onto the message or the diverted copy loses the
      // one field that says who it was for.
      const payload = buildSesPayload({
        ...MESSAGE,
        headers: { 'X-Skydrop-Original-To': 'real@example.com' },
      });
      const simple = (payload['Content'] as Record<string, Record<string, unknown>>)['Simple'];
      expect(simple?.['Headers']).toEqual([
        { Name: 'X-Skydrop-Original-To', Value: 'real@example.com' },
      ]);
    });

    it('omits Headers when there are none', () => {
      const payload = buildSesPayload(MESSAGE);
      const simple = (payload['Content'] as Record<string, Record<string, unknown>>)['Simple'];
      expect(simple).not.toHaveProperty('Headers');
    });
  });

  describe('failure classification (CUR-13: did SES judge the MESSAGE?)', () => {
    it.each([
      [429, 'TooManyRequestsException'],
      [503, 'SomethingElse'],
      [500, 'InternalServiceErrorException'],
      [400, 'SendingPausedException'],
      [400, 'AccountSuspendedException'],
      [400, 'LimitExceededException'],
      [400, 'MailFromDomainNotVerifiedException'],
      [404, 'NotFoundException'],
    ])('HTTP %i / %s is TRANSPORT — the other provider can carry it', (status, type) => {
      expect(classifySesFailure(status, type, 'whatever')).toBe('TRANSPORT');
    });

    it.each([
      ['MessageRejected', 'Address blocked by suppression list'],
      ['BadRequestException', 'Malformed content'],
      ['ValidationException', 'Invalid parameter'],
    ])('%s is MESSAGE — Resend would reach the same verdict', (type, detail) => {
      expect(classifySesFailure(400, type, detail)).toBe('MESSAGE');
    });

    it('treats a SANDBOX rejection as TRANSPORT, not as a bad address', () => {
      // The single most consequential call in this file. In the sandbox
      // SES refuses every unverified recipient with MessageRejected;
      // read as a verdict on the address it would mean MESSAGE, no
      // failover, and every customer email silently lost until AWS
      // grants production access. It is a fact about OUR ACCOUNT, and
      // Resend will deliver the identical message.
      expect(
        classifySesFailure(
          400,
          'MessageRejected',
          'Email address is not verified. The following identities failed the check in region AP-SOUTH-1: customer@example.com',
        ),
      ).toBe('TRANSPORT');
    });
  });
});

describe('AWS SigV4', () => {
  // These check the SHAPE and the sensitivity of the signature, not its
  // value against a published vector — there is no official AWS example
  // for this endpoint, and inventing one by running our own code and
  // pasting the result would be the code checking itself. What is
  // actually load-bearing here is caught below: the credential scope,
  // the signed-header set matching what is sent, and the signature
  // moving when the body or the secret moves. The real proof is a live
  // send, which was done by hand against the account before this was
  // written.
  const FIXED = new Date('2026-09-20T09:15:00.000Z');

  it('produces a stable, fully-formed Authorization header', () => {
    const headers = signRequest({
      method: 'POST',
      path: '/v2/email/outbound-emails',
      host: 'email.ap-south-1.amazonaws.com',
      region: 'ap-south-1',
      service: 'ses',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-example',
      body: '{"a":1}',
      contentType: 'application/json',
      now: FIXED,
    });

    expect(headers['X-Amz-Date']).toBe('20260920T091500Z');
    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256');
    expect(headers.Authorization).toContain(
      'Credential=AKIAEXAMPLE/20260920/ap-south-1/ses/aws4_request',
    );
    // The signed set must match what is actually sent, exactly. Signing
    // more or fewer headers fails as a 403 that explains nothing.
    expect(headers.Authorization).toContain('SignedHeaders=content-type;host;x-amz-date');
    expect(headers.Authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it('signs the BODY — a changed byte changes the signature', () => {
    const base = {
      method: 'POST' as const,
      path: '/v2/email/outbound-emails',
      host: 'email.ap-south-1.amazonaws.com',
      region: 'ap-south-1',
      service: 'ses',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-example',
      contentType: 'application/json',
      now: FIXED,
    };
    const a = signRequest({ ...base, body: '{"a":1}' });
    const b = signRequest({ ...base, body: '{"a":2}' });
    expect(a.Authorization).not.toBe(b.Authorization);
  });

  it('is deterministic for one instant and one key', () => {
    const req = {
      method: 'POST' as const,
      path: '/v2/email/outbound-emails',
      host: 'email.ap-south-1.amazonaws.com',
      region: 'ap-south-1',
      service: 'ses',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-example',
      body: '{"a":1}',
      contentType: 'application/json',
      now: FIXED,
    };
    expect(signRequest(req).Authorization).toBe(signRequest(req).Authorization);
  });

  it('changes the signature when the secret changes', () => {
    const base = {
      method: 'POST' as const,
      path: '/v2/email/outbound-emails',
      host: 'email.ap-south-1.amazonaws.com',
      region: 'ap-south-1',
      service: 'ses',
      accessKeyId: 'AKIAEXAMPLE',
      body: '{"a":1}',
      contentType: 'application/json',
      now: FIXED,
    };
    expect(signRequest({ ...base, secretAccessKey: 'one' }).Authorization).not.toBe(
      signRequest({ ...base, secretAccessKey: 'two' }).Authorization,
    );
  });
});
