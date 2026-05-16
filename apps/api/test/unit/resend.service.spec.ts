import { Logger } from '@nestjs/common';
import { ResendService } from '../../src/modules/email/services/resend.service';
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
        from: 'Skydrop Security <security@skydrop.online>',
        to: 'alex@x.io',
        subject: 'Reset',
        text: 'Body',
        replyTo: 'Skydrop Support <support@skydrop.online>',
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
});
