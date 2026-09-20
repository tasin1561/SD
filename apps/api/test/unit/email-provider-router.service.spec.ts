import { NotificationCategory } from '@skydrop/db';
import { EmailProviderRouter } from '../../src/modules/email/services/email-provider-router.service';
import { ProviderPacer } from '../../src/modules/email/services/provider-pacer';
import type { ResendService } from '../../src/modules/email/services/resend.service';
import type { SesService } from '../../src/modules/email/services/ses.service';
import type { SendEmailInput, SendEmailOutcome } from '../../src/modules/email/email-provider';
import { makeTestEnv } from '../helpers/env';

/**
 * `EmailProviderRouter` is the ONE place that decides which provider
 * carries a message — CUR-12 applied to email. These pin the four
 * decisions that are expensive to get wrong and invisible when they are:
 * the CREDENTIAL rule, failover in BOTH directions, the refusal to fail
 * over on a message the provider has already judged, and the inert
 * behaviour that makes shipping this change nothing at all.
 */

interface FakeProvider {
  readonly name: string;
  readonly maxPerSecond: number;
  isLive: () => boolean;
  send: jest.Mock<Promise<SendEmailOutcome>, [SendEmailInput]>;
}

function fakeProvider(
  name: string,
  maxPerSecond: number,
  live: boolean,
  outcome: SendEmailOutcome = { ok: true, providerMessageId: `${name}-1` },
): FakeProvider {
  return {
    name,
    maxPerSecond,
    isLive: () => live,
    send: jest.fn(async (_input: SendEmailInput) => outcome),
  };
}

function makeRouter(resend: FakeProvider, ses: FakeProvider): EmailProviderRouter {
  return new EmailProviderRouter(
    resend as unknown as ResendService,
    ses as unknown as SesService,
    makeTestEnv(),
    // Deterministic and instant: the pacer has its own suite.
    new ProviderPacer(
      () => 0,
      () => Promise.resolve(),
    ),
  );
}

const MESSAGE: SendEmailInput = {
  from: 'Skydrop <hello@skydrop.online>',
  to: 'customer@example.com',
  subject: 'Your order has shipped',
  text: 'Tracking: ABC123',
  replyTo: 'support@skydrop.online',
};

const TRANSPORT: SendEmailOutcome = {
  ok: false,
  code: 'rate_limit_exceeded',
  message: 'Too many requests',
  kind: 'TRANSPORT',
};

const MESSAGE_REFUSAL: SendEmailOutcome = {
  ok: false,
  code: 'invalid_to_address',
  message: 'The recipient address is not valid',
  kind: 'MESSAGE',
};

describe('EmailProviderRouter', () => {
  describe('the routing rule', () => {
    it('sends CREDENTIAL mail through Resend even when SES is live', async () => {
      // The one kind with no in-app fallback by construction (NOTIF-9),
      // so it gets a pipe a bulk send cannot starve — and that pipe is
      // exercised daily rather than held in reserve and left to rot.
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.CREDENTIAL);

      expect(result.provider).toBe('resend');
      expect(resend.send).toHaveBeenCalledTimes(1);
      expect(ses.send).not.toHaveBeenCalled();
    });

    it('sends everything else through SES when SES is live', async () => {
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true);
      const router = makeRouter(resend, ses);

      for (const category of [
        NotificationCategory.OPERATIONAL,
        NotificationCategory.INFORMATIONAL,
        NotificationCategory.ANNOUNCEMENT,
      ]) {
        const result = await router.send(MESSAGE, category);
        expect(result.provider).toBe('ses');
      }

      expect(ses.send).toHaveBeenCalledTimes(3);
      expect(resend.send).not.toHaveBeenCalled();
    });
  });

  describe('inert when SES is not configured — the shipping posture', () => {
    it('routes EVERY category to Resend, and never touches SES', async () => {
      // This is the whole dark-ship guarantee: no credentials, no
      // change in behaviour.
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, false);
      const router = makeRouter(resend, ses);

      for (const category of [
        NotificationCategory.CREDENTIAL,
        NotificationCategory.OPERATIONAL,
        NotificationCategory.INFORMATIONAL,
        NotificationCategory.ANNOUNCEMENT,
      ]) {
        const result = await router.send(MESSAGE, category);
        expect(result.provider).toBe('resend');
        expect(result.failedOverFrom).toBeNull();
      }

      expect(ses.send).not.toHaveBeenCalled();
    });

    it('keeps the queue limiter at Resend’s rate', async () => {
      const router = makeRouter(fakeProvider('resend', 2, true), fakeProvider('ses', 14, false));
      expect(router.queueRateLimitPerSecond).toBe(2);
    });

    it('raises the queue limiter to the fastest live provider once SES is on', async () => {
      const router = makeRouter(fakeProvider('resend', 2, true), fakeProvider('ses', 14, true));
      expect(router.queueRateLimitPerSecond).toBe(14);
    });

    it('falls back to Resend’s rate in dev, where neither provider is live', async () => {
      const router = makeRouter(fakeProvider('resend', 2, false), fakeProvider('ses', 14, false));
      expect(router.queueRateLimitPerSecond).toBe(2);
    });
  });

  describe('failover is symmetric (CUR-14)', () => {
    it('SES → Resend on a transport failure', async () => {
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true, TRANSPORT);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.OPERATIONAL);

      expect(result.provider).toBe('resend');
      expect(result.failedOverFrom).toBe('ses');
      expect(result.outcome.ok).toBe(true);
      expect(resend.send).toHaveBeenCalledTimes(1);
    });

    it('Resend → SES on a transport failure, through the SAME code path', async () => {
      // The router never names a provider; it asks for "the other live
      // one". A direction special-cased here is a direction that rots.
      const resend = fakeProvider('resend', 2, true, TRANSPORT);
      const ses = fakeProvider('ses', 14, true);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.CREDENTIAL);

      expect(result.provider).toBe('ses');
      expect(result.failedOverFrom).toBe('resend');
      expect(result.outcome.ok).toBe(true);
    });

    it('hands the alternate the SAME message', async () => {
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true, TRANSPORT);
      const router = makeRouter(resend, ses);

      await router.send(MESSAGE, NotificationCategory.OPERATIONAL);

      expect(resend.send.mock.calls[0]?.[0]).toEqual(ses.send.mock.calls[0]?.[0]);
    });
  });

  describe('a message the provider judged is NOT failed over (CUR-13)', () => {
    it('keeps a rejected address on the provider that rejected it', async () => {
      // Sending a known-bad address to the reserve provider doubles the
      // bounce and damages both reputations — and the reserve is what
      // carries password resets.
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true, MESSAGE_REFUSAL);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.OPERATIONAL);

      expect(result.provider).toBe('ses');
      expect(result.failedOverFrom).toBeNull();
      expect(result.outcome.ok).toBe(false);
      expect(resend.send).not.toHaveBeenCalled();
    });

    it('treats an UNCLASSIFIED failure as a message refusal', async () => {
      // The conservative default: not using the reserve costs one email
      // BullMQ will retry; guessing the other way poisons it.
      const unclassified: SendEmailOutcome = {
        ok: false,
        code: 'SOMETHING_NEW',
        message: 'A failure shape nobody has classified yet',
      };
      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true, unclassified);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.OPERATIONAL);

      expect(result.failedOverFrom).toBeNull();
      expect(resend.send).not.toHaveBeenCalled();
    });
  });

  describe('a stub may never answer for a live provider (CUR-15)', () => {
    it('refuses to fail over from a LIVE SES into the Resend dev stub', async () => {
      // The stub returns ok with a null id. Failing over into it would
      // report "sent" for a message nobody sent, and the recipient would
      // never hear from us.
      const resend = fakeProvider('resend', 2, false);
      const ses = fakeProvider('ses', 14, true, TRANSPORT);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.OPERATIONAL);

      expect(resend.send).not.toHaveBeenCalled();
      expect(result.provider).toBe('ses');
      expect(result.failedOverFrom).toBeNull();
      expect(result.outcome.ok).toBe(false);
    });

    it('DOES fail over when both are stubbed — that is dev and CI', async () => {
      const resend = fakeProvider('resend', 2, false);
      const ses = fakeProvider('ses', 14, false, TRANSPORT);
      const router = makeRouter(resend, ses);

      const result = await router.send(MESSAGE, NotificationCategory.CREDENTIAL);

      // CREDENTIAL starts at Resend; Resend is fine here, so nothing
      // fails over. Drive the other direction to exercise the rule.
      expect(result.provider).toBe('resend');

      const bothStubbed = makeRouter(
        fakeProvider('resend', 2, false, TRANSPORT),
        fakeProvider('ses', 14, false),
      );
      const second = await bothStubbed.send(MESSAGE, NotificationCategory.CREDENTIAL);
      expect(second.provider).toBe('ses');
      expect(second.failedOverFrom).toBe('resend');
    });
  });

  describe('pacing', () => {
    it('paces each provider at its OWN rate, not a shared one', async () => {
      const waits: Array<{ provider: string; ms: number }> = [];
      const pacer = new ProviderPacer(
        () => 0,
        () => Promise.resolve(),
      );
      const takeSpy = jest.spyOn(pacer, 'take');

      const resend = fakeProvider('resend', 2, true);
      const ses = fakeProvider('ses', 14, true);
      const router = new EmailProviderRouter(
        resend as unknown as ResendService,
        ses as unknown as SesService,
        makeTestEnv(),
        pacer,
      );

      await router.send(MESSAGE, NotificationCategory.OPERATIONAL);
      await router.send(MESSAGE, NotificationCategory.CREDENTIAL);

      for (const call of takeSpy.mock.calls) {
        waits.push({ provider: call[0], ms: call[1] });
      }
      expect(waits).toEqual([
        { provider: 'ses', ms: 14 },
        { provider: 'resend', ms: 2 },
      ]);
    });
  });
});
