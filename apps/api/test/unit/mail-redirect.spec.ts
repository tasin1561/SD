import { ResendService } from '../../src/modules/email/services/resend.service';
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
 */

type SentArgs = Record<string, unknown>;

function makeSut(redirectTo: string, apiKey = 're_fake_key') {
  const sent: SentArgs[] = [];
  const svc = new ResendService(
    makeTestEnv({ MAIL_REDIRECT_TO: redirectTo, RESEND_API_KEY: apiKey }),
  );
  // Stand in for the Resend SDK. The assertion that matters is what
  // would have gone over the wire.
  (svc as unknown as { client: unknown }).client = {
    emails: {
      send: async (args: SentArgs) => {
        sent.push(args);
        return { data: { id: 'msg-1' }, error: null };
      },
    },
  };
  (svc as unknown as { devMode: boolean }).devMode = apiKey === '';
  return { svc, sent };
}

const MESSAGE = {
  from: 'Skydrop <hello@skydrop.online>',
  to: 'real.customer@gmail.com',
  subject: 'Your order has shipped',
  text: 'Tracking: ABC123',
  replyTo: 'support@skydrop.online',
};

describe('MAIL_REDIRECT_TO', () => {
  it('sends to the redirect address, never the real recipient', async () => {
    const { svc, sent } = makeSut('founder@skydrop.online');

    await svc.send(MESSAGE);

    expect(sent).toHaveLength(1);
    // `to` is the only field that decides where it lands, and it is the
    // only one that must change. The original address deliberately
    // survives in the subject and a header — that is how you know who
    // the message was for — so asserting it is absent from the whole
    // payload would be asserting the opposite of the design.
    expect(sent[0]!['to']).toBe('founder@skydrop.online');
  });

  it('says in the subject who it was meant for', async () => {
    // What you read in a list of forty test emails.
    const { svc, sent } = makeSut('founder@skydrop.online');
    await svc.send(MESSAGE);
    expect(sent[0]!['subject']).toBe('[→ real.customer@gmail.com] Your order has shipped');
  });

  it('keeps the real recipient in a header, which survives forwarding', async () => {
    const { svc, sent } = makeSut('founder@skydrop.online');
    await svc.send(MESSAGE);
    expect((sent[0]!['headers'] as Record<string, string>)['X-Skydrop-Original-To']).toBe(
      'real.customer@gmail.com',
    );
  });

  it('leaves the body and sender untouched — it is the same email', async () => {
    const { svc, sent } = makeSut('founder@skydrop.online');
    await svc.send(MESSAGE);
    expect(sent[0]!['text']).toBe('Tracking: ABC123');
    expect(sent[0]!['from']).toBe('Skydrop <hello@skydrop.online>');
    expect(sent[0]!['replyTo']).toBe('support@skydrop.online');
  });

  it('delivers normally when unset — production must not be diverted', async () => {
    const { svc, sent } = makeSut('');
    await svc.send(MESSAGE);
    expect(sent[0]!['to']).toBe('real.customer@gmail.com');
    expect(sent[0]!['subject']).toBe('Your order has shipped');
  });

  it('does not rewrite a message already addressed to the redirect', async () => {
    // Otherwise the founder's own notifications arrive with a pointless
    // "[→ founder@…]" stapled to every subject line.
    const { svc, sent } = makeSut('founder@skydrop.online');
    await svc.send({ ...MESSAGE, to: 'founder@skydrop.online' });
    expect(sent[0]!['subject']).toBe('Your order has shipped');
  });
});
