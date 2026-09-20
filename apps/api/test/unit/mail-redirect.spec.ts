import { NotificationCategory } from '@skydrop/db';
import { EmailProviderRouter } from '../../src/modules/email/services/email-provider-router.service';
import type { ResendService } from '../../src/modules/email/services/resend.service';
import type { SesService } from '../../src/modules/email/services/ses.service';
import type { SendEmailInput, SendEmailOutcome } from '../../src/modules/email/email-provider';
import { ProviderPacer } from '../../src/modules/email/services/provider-pacer';
import { makeTestEnv } from '../helpers/env';

/**
 * Diverting staging mail to one inbox.
 *
 * Staging exists to test the real system, and mail is part of it — but
 * a test order carries a real-looking customer address, and there is no
 * version of "oops" that unsends it. `MAIL_REDIRECT_TO` moves every
 * message to one inbox so the notifications can be READ without any of
 * them being able to arrive anywhere else.
 *
 * A redirect rather than an allow-list on purpose: an allow-list
 * silently drops whatever nobody thought to list, which is exactly the
 * set worth looking at.
 *
 * ── WHY THESE ASSERT ON THE ROUTER RATHER THAN ON ResendService ──────
 * The redirect used to live inside `ResendService`, which was right
 * while Resend was the only provider. With two, a per-provider redirect
 * is one provider away from being forgotten — and forgetting it means a
 * staging box mailing real customers, the precise thing the setting
 * exists to prevent. `EmailProviderRouter` now applies it ONCE, above
 * every adapter (CUR-12: what must happen identically lives outside the
 * adapters). The messages asserted on below are what the provider is
 * handed, which is what goes over the wire.
 */

function makeSut(redirectTo: string) {
  const sent: SendEmailInput[] = [];

  const resend = {
    name: 'resend',
    maxPerSecond: 2,
    isLive: () => true,
    send: async (input: SendEmailInput): Promise<SendEmailOutcome> => {
      sent.push(input);
      return { ok: true, providerMessageId: 'msg-1' };
    },
  } as unknown as ResendService;

  // SES unconfigured — everything routes to Resend, as in production
  // before SES is switched on.
  const ses = {
    name: 'ses',
    maxPerSecond: 14,
    isLive: () => false,
    send: async (): Promise<SendEmailOutcome> => {
      throw new Error('SES must not be reached when it is not live');
    },
  } as unknown as SesService;

  const router = new EmailProviderRouter(
    resend,
    ses,
    makeTestEnv({ MAIL_REDIRECT_TO: redirectTo }),
    // No real waiting in tests.
    new ProviderPacer(
      () => 0,
      () => Promise.resolve(),
    ),
  );

  return { router, sent };
}

const MESSAGE: SendEmailInput = {
  from: 'Skydrop <hello@skydrop.online>',
  to: 'real.customer@gmail.com',
  subject: 'Your order has shipped',
  text: 'Tracking: ABC123',
  replyTo: 'support@skydrop.online',
};

const CATEGORY = NotificationCategory.OPERATIONAL;

describe('MAIL_REDIRECT_TO', () => {
  it('sends to the redirect address, never the real recipient', async () => {
    const { router, sent } = makeSut('founder@skydrop.online');

    await router.send(MESSAGE, CATEGORY);

    expect(sent).toHaveLength(1);
    // `to` is the only field that decides where it lands, and it is the
    // only one that must change. The original address deliberately
    // survives in the subject and a header — that is how you know who
    // the message was for — so asserting it is absent from the whole
    // payload would be asserting the opposite of the design.
    expect(sent[0]?.to).toBe('founder@skydrop.online');
  });

  it('says in the subject who it was meant for', async () => {
    // What you read in a list of forty test emails.
    const { router, sent } = makeSut('founder@skydrop.online');
    await router.send(MESSAGE, CATEGORY);
    expect(sent[0]?.subject).toBe('[→ real.customer@gmail.com] Your order has shipped');
  });

  it('keeps the real recipient in a header, which survives forwarding', async () => {
    const { router, sent } = makeSut('founder@skydrop.online');
    await router.send(MESSAGE, CATEGORY);
    expect(sent[0]?.headers?.['X-Skydrop-Original-To']).toBe('real.customer@gmail.com');
  });

  it('leaves the body and sender untouched — it is the same email', async () => {
    const { router, sent } = makeSut('founder@skydrop.online');
    await router.send(MESSAGE, CATEGORY);
    expect(sent[0]?.text).toBe('Tracking: ABC123');
    expect(sent[0]?.from).toBe('Skydrop <hello@skydrop.online>');
    expect(sent[0]?.replyTo).toBe('support@skydrop.online');
  });

  it('delivers normally when unset — production must not be diverted', async () => {
    const { router, sent } = makeSut('');
    await router.send(MESSAGE, CATEGORY);
    expect(sent[0]?.to).toBe('real.customer@gmail.com');
    expect(sent[0]?.subject).toBe('Your order has shipped');
  });

  it('does not rewrite a message already addressed to the redirect', async () => {
    // Otherwise the founder's own notifications arrive with a pointless
    // "[→ founder@…]" stapled to every subject line.
    const { router, sent } = makeSut('founder@skydrop.online');
    await router.send({ ...MESSAGE, to: 'founder@skydrop.online' }, CATEGORY);
    expect(sent[0]?.subject).toBe('Your order has shipped');
  });

  it('diverts CREDENTIAL mail too — it is the provider that differs, not the rule', async () => {
    // A password reset from staging reaching a real inbox is the worst
    // version of this failure, not an exception to it.
    const { router, sent } = makeSut('founder@skydrop.online');
    await router.send(MESSAGE, NotificationCategory.CREDENTIAL);
    expect(sent[0]?.to).toBe('founder@skydrop.online');
  });
});
