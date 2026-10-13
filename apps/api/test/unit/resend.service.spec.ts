import { Logger } from '@nestjs/common';
import {
  ResendService,
  classifyResendFailure,
} from '../../src/modules/email/services/resend.service';
import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';

function envWithKey(key: string): EnvService {
  return makeTestEnv({ RESEND_API_KEY: key });
}

describe('ResendService', () => {
  describe('dev mode (no API key)', () => {
    it('logs to console with the [DEV] prefix and returns ok', async () => {
      const env = envWithKey('');
      const svc = new ResendService(env);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      const result = await svc.send({
        from: 'Skydrop Security <security@skydrop.global>',
        to: 'alex@x.io',
        subject: 'Reset',
        text: 'Body',
        replyTo: 'Skydrop Support <support@skydrop.global>',
      });

      expect(result).toEqual({ ok: true, providerMessageId: null });
      expect(logSpy).toHaveBeenCalled();
      const msg = logSpy.mock.calls[0]![0] as string;
      expect(msg).toContain('[DEV] Would send email');
      expect(msg).toContain('subject="Reset"');
      expect(msg).toContain('to="alex@x.io"');
      logSpy.mockRestore();
    });

    it('truncates long bodies in the dev-mode log line', async () => {
      const env = envWithKey('');
      const svc = new ResendService(env);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await svc.send({
        from: 'a@b.io',
        to: 'c@d.io',
        subject: 's',
        text: 'x'.repeat(500),
        replyTo: 'r@x.io',
      });

      const msg = logSpy.mock.calls[0]![0] as string;
      // We truncate at 240 chars and append the ellipsis.
      expect(msg).toContain('…');
      logSpy.mockRestore();
    });
  });

  /**
   * NOTIF-24 — the classification that decides whether CREDENTIAL mail
   * survives Resend's daily cap.
   *
   * Resend's free tier stops at 100 messages a day, and under NOTIF-24
   * credential mail is the ONE category pinned to Resend: password
   * resets, invitations and email verification, which by NOTIF-9 have no
   * in-app copy to fall back on. The only thing that carries them past
   * that cap is `daily_quota_exceeded` being read as TRANSPORT, which
   * sends them to SES and its 50,000/day instead.
   *
   * Nothing about that is obvious from the Set, and it reads exactly
   * like a list of Resend error strings somebody could tidy. Drop the
   * quota entry and the failure mode is the worst shape this codebase
   * knows: a password reset that is never sent, on the busiest day,
   * with no second channel and nothing raised — because MESSAGE-kind
   * failures deliberately do not fail over (CUR-13), so the message
   * would be correctly, silently abandoned.
   */
  describe('failure classification (NOTIF-24 / CUR-13)', () => {
    it('reads the DAILY QUOTA as transport, which is what saves credential mail', () => {
      expect(classifyResendFailure('daily_quota_exceeded')).toBe('TRANSPORT');
    });

    it('reads every other account- or pipe-level error as transport too', () => {
      // Each of these says something about OUR account or THEIR service
      // and leaves the message perfectly sendable by the other provider.
      for (const code of [
        'rate_limit_exceeded',
        'internal_server_error',
        'application_error',
        'invalid_access',
        'restricted_api_key',
        'not_found',
        'method_not_allowed',
        'concurrent_idempotent_requests',
      ]) {
        expect(classifyResendFailure(code)).toBe('TRANSPORT');
      }
    });

    it('reads a verdict ABOUT THE MESSAGE as a message failure, so it is not re-sent', () => {
      // Resend read this and refused it; SES would reach the same view,
      // and asking doubles the bounce across both reputations (CUR-13).
      expect(classifyResendFailure('invalid_to_address')).toBe('MESSAGE');
      expect(classifyResendFailure('validation_error')).toBe('MESSAGE');
    });

    it('treats an UNRECOGNISED code as a message failure', () => {
      // The safe default is not to re-send: an unknown code is more
      // likely a new way of saying "this message is bad" than a new
      // outage, and a wrong guess here costs sender reputation twice.
      expect(classifyResendFailure('something_resend_added_last_tuesday')).toBe('MESSAGE');
    });
  });
});
